import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../config';
import { KYSELY, type KyselyDb } from '../db';
import {
  EVENT_PUBLISHER,
  type EventPublisherPort,
  type OutboxMessage,
} from './event-publisher.port';
import {
  MAX_PUBLISH_RETRIES,
  PUBLISHER_BATCH_SIZE,
  PUBLISHER_POLL_INTERVAL_MS,
} from './outbox.constants';

/** Outcome counters for one poll cycle (also surfaced as worker metrics). */
export interface PollResult {
  published: number;
  failed: number;
  /** Rows attempted but left `pending` for a later cycle (transient failures). */
  rescheduled: number;
}

/**
 * FR-141 — the background relay worker (ADR-7, Path B). On a fixed interval it
 * polls `event_outbox` for `pending` rows and relays each to Pub/Sub via the
 * injected {@link EventPublisherPort}, then advances the row `pending →
 * published` (success) or `pending → failed` (after {@link MAX_PUBLISH_RETRIES}
 * exhausted). It runs entirely OUTSIDE any UnitOfWork transaction — it reads
 * committed rows and issues independent per-row UPDATEs.
 *
 * Delivery is at-least-once: the poll→publish→mark loop is not atomic, so a
 * crash between publish and mark re-publishes the row next cycle. Consumers must
 * deduplicate on `event_id`. Unlike the audit hash-chain (single-writer, ADR-5),
 * this worker needs no concurrency=1 — duplicate publishes are acceptable.
 *
 * Publish attempts are counted in-memory per row across cycles (one attempt per
 * cycle); the count resets on process restart, giving a stuck row further
 * attempts — acceptable under at-least-once.
 */
@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly attempts = new Map<string, number>();

  /** Cumulative worker metrics (surfaced to the integration monitor, FR-140). */
  private publishedTotal = 0;
  private deadLetterTotal = 0;

  constructor(
    @InjectPinoLogger(OutboxPublisherService.name) private readonly logger: PinoLogger,
    @Inject(KYSELY) private readonly db: KyselyDb,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Start the self-scheduling poll loop. Disabled under `NODE_ENV=test` so unit
   * tests drive {@link runOnce} explicitly and no timer leaks between specs.
   */
  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, PUBLISHER_POLL_INTERVAL_MS);
    // Do not keep the event loop alive solely for the poller (clean shutdown).
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Guard against overlapping cycles if a poll outlasts the interval. */
  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      // A cycle-level failure (e.g. the poll SELECT) must not kill the timer.
      this.logger.error({ err }, 'outbox publisher cycle failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * One poll cycle: select up to {@link PUBLISHER_BATCH_SIZE} pending rows
   * (oldest first; the LIMIT also satisfies the NFR list-query rule) and attempt
   * to publish each exactly once. Returns the cycle outcome. Directly unit-tested.
   */
  async runOnce(): Promise<PollResult> {
    const rows = await this.db
      .selectFrom('event_outbox')
      .select([
        'event_id',
        'event_code',
        'aggregate_type',
        'aggregate_id',
        'payload',
        'schema_version',
        'org_id',
        'created_at',
      ])
      .where('status', '=', 'pending')
      .orderBy('created_at', 'asc')
      .limit(PUBLISHER_BATCH_SIZE)
      .execute();

    const result: PollResult = { published: 0, failed: 0, rescheduled: 0 };

    for (const row of rows) {
      const outcome = await this.relay(row);
      result[outcome] += 1;
    }

    if (rows.length > 0) {
      this.logger.info(
        {
          published: result.published,
          failed: result.failed,
          rescheduled: result.rescheduled,
          outbox_published_total: this.publishedTotal,
          outbox_dead_letter_total: this.deadLetterTotal,
        },
        'outbox publisher cycle complete',
      );
    }
    return result;
  }

  /** Publish one row; advance its state. One attempt per call. */
  private async relay(
    row: {
      event_id: string;
      event_code: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: unknown;
      schema_version: number;
      org_id: string;
      created_at: Date | string;
    },
  ): Promise<'published' | 'failed' | 'rescheduled'> {
    const message = this.toMessage(row);
    try {
      await this.publisher.publish(message);
    } catch (err) {
      return this.onPublishError(row.event_id, err);
    }

    await this.markPublished(row.event_id);
    this.attempts.delete(row.event_id);
    this.publishedTotal += 1;
    return 'published';
  }

  /**
   * Record a failed attempt. Leave the row `pending` for the next cycle until
   * {@link MAX_PUBLISH_RETRIES} is reached, then mark it `failed` (dead-letter).
   */
  private async onPublishError(
    eventId: string,
    err: unknown,
  ): Promise<'failed' | 'rescheduled'> {
    const attempt = (this.attempts.get(eventId) ?? 0) + 1;
    this.attempts.set(eventId, attempt);

    if (attempt >= MAX_PUBLISH_RETRIES) {
      await this.markFailed(eventId);
      this.attempts.delete(eventId);
      this.deadLetterTotal += 1;
      this.logger.error(
        { event_id: eventId, attempts: attempt, outbox_dead_letter_total: this.deadLetterTotal, err },
        'outbox publish exhausted retries; row marked failed (dead-letter)',
      );
      return 'failed';
    }

    this.logger.warn(
      { event_id: eventId, attempts: attempt, err },
      'outbox publish failed; leaving row pending for retry',
    );
    return 'rescheduled';
  }

  /** `pending → published` (guarded). 0 rows affected ⇒ another writer won. */
  private async markPublished(eventId: string): Promise<void> {
    const now = new Date();
    await this.db
      .updateTable('event_outbox')
      .set({ status: 'published', published_at: now, updated_at: now })
      .where('event_id', '=', eventId)
      .where('status', '=', 'pending')
      .execute();
  }

  /** `pending → failed` (guarded). */
  private async markFailed(eventId: string): Promise<void> {
    await this.db
      .updateTable('event_outbox')
      .set({ status: 'failed', updated_at: new Date() })
      .where('event_id', '=', eventId)
      .where('status', '=', 'pending')
      .execute();
  }

  /** Build the Pub/Sub wire message (FR-141 Path B step 3). */
  private toMessage(row: {
    event_id: string;
    event_code: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: unknown;
    schema_version: number;
    org_id: string;
    created_at: Date | string;
  }): OutboxMessage {
    const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
    return {
      eventId: row.event_id,
      data: {
        event_id: row.event_id,
        event_code: row.event_code,
        aggregate_type: row.aggregate_type,
        aggregate_id: row.aggregate_id,
        schema_version: row.schema_version,
        payload: row.payload,
        org_id: row.org_id,
        created_at: createdAt,
      },
      attributes: {
        event_code: row.event_code,
        aggregate_type: row.aggregate_type,
        schema_version: String(row.schema_version),
      },
    };
  }

  /** Current dead-letter count (integration monitor / Cloud Monitoring metric). */
  get deadLetterCount(): number {
    return this.deadLetterTotal;
  }

  /** Current published count (integration monitor / Cloud Monitoring metric). */
  get publishedCount(): number {
    return this.publishedTotal;
  }
}
