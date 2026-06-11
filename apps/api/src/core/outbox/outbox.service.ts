import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { EventCode } from '@lms/shared';

import { DomainException } from '../http/domain-exception';
import { MaskingService } from '../masking';
import type { DbTransaction } from '../db';
import { DEFAULT_SCHEMA_VERSION, ORG_ID_DEFAULT } from './outbox.constants';

/**
 * The pinned `emit` payload (CORRECTIONS.md / shared-utilities.md): an OBJECT,
 * not positional arguments. `schema_version` is optional and defaults to 1
 * ({@link DEFAULT_SCHEMA_VERSION}); bump it when a payload shape evolves.
 */
export interface OutboxEvent {
  event_code: EventCode;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  schema_version?: number;
}

/**
 * Validates `emit` arguments at the service boundary (FR-141 LLD §Validation).
 * A failure here is a programming error, not user input, so it maps to
 * INTERNAL_ERROR (500) — never VALIDATION_ERROR (400).
 */
const emitSchema = z.object({
  event_code: z.nativeEnum(EventCode),
  aggregate_type: z.string().min(1).max(40),
  aggregate_id: z.string().uuid(),
  payload: z.record(z.unknown()),
  schema_version: z.number().int().min(1).default(DEFAULT_SCHEMA_VERSION),
});

/**
 * FR-141 — transactional outbox write helper (ADR-7). Every state-changing FR
 * calls {@link emit} INSIDE its UnitOfWork transaction, passing the active `tx`,
 * so the `event_outbox` row commits atomically with the state change (no
 * dual-write: if the tx rolls back, no orphan event row remains). A separate
 * post-commit worker ({@link OutboxPublisherService}) relays pending rows to
 * Pub/Sub.
 *
 * PII is masked ({@link MaskingService.maskEventPayload}) BEFORE the row is
 * written — raw PII never enters the event store (security.md). `emit` issues
 * INSERT only; it never opens its own transaction.
 */
@Injectable()
export class OutboxService {
  constructor(
    @InjectPinoLogger(OutboxService.name) private readonly logger: PinoLogger,
    private readonly masking: MaskingService,
  ) {}

  /**
   * Append a domain event to `event_outbox` (status `pending`) within the
   * caller's transaction. `tx` is REQUIRED — calling this outside a UnitOfWork
   * transaction is a programming error (the type enforces a {@link DbTransaction}).
   *
   * @throws DomainException(INTERNAL_ERROR) on invalid args, masking failure, or
   *   INSERT failure. The error is logged (correlation id is bound by the pino
   *   request logger) and rethrown; the caller's UnitOfWork decides whether to
   *   roll back — which, since `emit` runs inside that tx, it will if uncaught.
   */
  async emit(event: OutboxEvent, tx: DbTransaction): Promise<void> {
    let validated: z.infer<typeof emitSchema>;
    try {
      validated = emitSchema.parse(event);
    } catch (cause) {
      // Do not log the payload (may contain unmasked PII at this point).
      this.logger.error(
        { event_code: (event as Partial<OutboxEvent>)?.event_code, err: cause },
        'outbox emit rejected: invalid event envelope',
      );
      throw new DomainException('INTERNAL_ERROR', undefined, { cause });
    }

    let maskedPayload: Record<string, unknown>;
    try {
      maskedPayload = this.masking.maskEventPayload(validated.payload);
    } catch (cause) {
      this.logger.error(
        { event_code: validated.event_code, aggregate_type: validated.aggregate_type, err: cause },
        'outbox emit rejected: payload masking failed',
      );
      throw new DomainException('INTERNAL_ERROR', undefined, { cause });
    }

    try {
      await tx
        .insertInto('event_outbox')
        .values({
          org_id: ORG_ID_DEFAULT,
          event_code: validated.event_code,
          aggregate_type: validated.aggregate_type,
          aggregate_id: validated.aggregate_id,
          payload: JSON.stringify(maskedPayload),
          schema_version: validated.schema_version,
          status: 'pending',
          published_at: null,
          // event_id, created_at, updated_at: DB defaults.
        })
        .execute();
    } catch (cause) {
      this.logger.error(
        { event_code: validated.event_code, aggregate_id: validated.aggregate_id, err: cause },
        'outbox emit failed: event_outbox insert error',
      );
      throw new DomainException('INTERNAL_ERROR', undefined, { cause });
    }
  }
}
