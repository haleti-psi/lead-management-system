import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditAction } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { AppConfigService } from '../../core/config';
import { UnitOfWork } from '../../core/db';
import {
  BREAK_GLASS_EXPIRY_INTERVAL_MS,
} from './break-glass.constants';
import { BreakGlassRepository } from './break-glass.repository';
import { DEFAULT_ORG_ID, SYSTEM_USER_ID } from './identity.constants';

/** Outcome of one expiry-sweep cycle (also useful as a worker metric). */
export interface ExpirySweepResult {
  /** Number of grants flipped `active → expired` this cycle. */
  expired: number;
}

/**
 * FR-003 expiry sweep (LLD §Scheduled expiry sweep). On a fixed interval it
 * flips `active` grants whose `valid_until` has passed to `expired` and appends
 * a `break_glass_access` (`grant_expired`) audit row for each, inside a single
 * {@link UnitOfWork} transaction per cycle. Idempotent and re-run-safe: an
 * already-expired row is not matched again.
 *
 * Scheduling mirrors the FR-141 outbox publisher: a self-managed `setInterval`
 * that is disabled under `NODE_ENV=test` so specs drive {@link runOnce}
 * explicitly and no timer leaks between tests. The actor for the system-issued
 * status change is the reserved system user.
 */
@Injectable()
export class BreakGlassExpiryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @InjectPinoLogger(BreakGlassExpiryJob.name) private readonly logger: PinoLogger,
    private readonly repo: BreakGlassRepository,
    private readonly audit: AuditAppender,
    private readonly uow: UnitOfWork,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, BREAK_GLASS_EXPIRY_INTERVAL_MS);
    // Do not keep the event loop alive solely for the sweep (clean shutdown).
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Guard against overlapping cycles if a sweep outlasts the interval. */
  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      // A cycle-level failure must not kill the timer.
      this.logger.error({ err }, 'break-glass expiry sweep cycle failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * One sweep cycle: expire up to the batch limit of due grants and audit each.
   * The bulk UPDATE and its audit appends commit atomically. Directly unit-tested.
   */
  async runOnce(): Promise<ExpirySweepResult> {
    const now = new Date();
    const expiredIds = await this.uow.run(async (tx) => {
      const ids = await this.repo.expireDue(SYSTEM_USER_ID, now, tx);
      for (const grantId of ids) {
        await this.audit.append(
          {
            action: AuditAction.BREAK_GLASS_ACCESS,
            entity_type: 'break_glass_grants',
            entity_id: grantId,
            actor_id: SYSTEM_USER_ID,
            org_id: DEFAULT_ORG_ID,
            detail: { event: 'grant_expired' },
          },
          tx,
        );
      }
      return ids;
    });

    if (expiredIds.length > 0) {
      this.logger.info({ expired: expiredIds.length }, 'break-glass expiry sweep complete');
    }
    return { expired: expiredIds.length };
  }
}
