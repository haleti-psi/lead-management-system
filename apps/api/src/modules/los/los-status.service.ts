import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  ERROR_CODES,
  IntegrationKind,
  MirrorSource,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { IntegrationGateway } from '../../core/integration/integration-gateway';
import { SYSTEM_USER_ID } from '../../core/integration/integration.constants';
import { LOS_PORT } from '../../core/integration/ports/los.port';
import type { IntegrationPort } from '../../core/integration/ports/integration-port';
import type { LosStatusWebhookDto } from './dto/los-status-webhook.dto';
import { LosApplicationMirrorRepository } from './los-application-mirror.repository';

/** How many minutes before a mirror is considered stale and needs poll reconciliation. */
const RECONCILE_STALE_MINUTES = 60;

/** Result returned from processStatusUpdate — callers only need idempotency info. */
export interface StatusUpdateResult {
  idempotentReplay: boolean;
}

/** Per-lead result from the reconciliation batch. */
export interface ReconcileResult {
  processed: number;
  failed: number;
}

/**
 * FR-082 — LOS application status mirror service.
 *
 * Owns two operations:
 *  1. `processStatusUpdate` — inbound webhook processing (and poll-driven reconcile).
 *  2. `reconcile` — Cloud Scheduler periodic poll for stale mirrors (§14.7).
 *
 * Key invariants:
 *  - Idempotent by `event_id` (integration_logs.idempotency_key unique index).
 *  - Out-of-order protected by the upsert's WHERE clause (status_date comparison).
 *  - All writes (mirror upsert + integration_log + audit) inside ONE UnitOfWork tx.
 *  - Unknown los_application_id → log + return 200 (acknowledge; do not throw).
 *  - PII never logged; LOS_WEBHOOK_HMAC_SECRET never logged.
 */
@Injectable()
export class LosStatusService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    @Inject(LOS_PORT) private readonly losPort: IntegrationPort,
    private readonly uow: UnitOfWork,
    private readonly mirrorRepository: LosApplicationMirrorRepository,
    private readonly audit: AuditAppender,
    private readonly integrationGateway: IntegrationGateway,
    @InjectPinoLogger(LosStatusService.name) private readonly logger: PinoLogger,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Process one inbound LOS status event.
   *
   * Called by the webhook controller (receivedVia = 'webhook') and by
   * `reconcile()` (receivedVia = 'poll'). Returns `idempotentReplay: true` when
   * the event_id is already in integration_logs (caller returns 200 with no further
   * side-effects).
   */
  async processStatusUpdate(
    dto: LosStatusWebhookDto,
    receivedVia: MirrorSource,
    correlationId: string,
  ): Promise<StatusUpdateResult> {
    // ── Step 1: idempotency check (before tx — fast path) ─────────────────────
    const existing = await this.db
      .selectFrom('integration_logs')
      .select(['integration_log_id', 'status'])
      .where('idempotency_key', '=', dto.event_id)
      .limit(1)
      .executeTakeFirst();

    if (existing) {
      this.logger.info({ event_id: dto.event_id, correlation_id: correlationId }, 'FR-082 idempotent replay');
      return { idempotentReplay: true };
    }

    // ── Step 2: lead lookup ───────────────────────────────────────────────────
    const lead = await this.db
      .selectFrom('leads')
      .select(['lead_id', 'org_id', 'stage', 'version', 'los_application_id'])
      .where('los_application_id', '=', dto.los_application_id)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();

    if (!lead) {
      // Unknown app ID — acknowledge per BRD (log + ignore).
      this.logger.warn(
        { correlation_id: correlationId, received_via: receivedVia },
        'FR-082 unknown los_application_id — logged and acknowledged',
      );
      await this.writeFailedIntegrationLog(dto, correlationId, 'UNKNOWN_APP_ID');
      return { idempotentReplay: false };
    }

    // ── Step 3: UnitOfWork — upsert mirror + integration_log + audit ──────────
    const statusDate = new Date(dto.status_date);
    const resolvedCorrelationId = dto.correlation_id ?? correlationId;

    await this.uow.run(async (tx) => {
      // a. Upsert los_application_mirrors (out-of-order protected by WHERE).
      await this.mirrorRepository.upsertMirror(
        {
          orgId: lead.org_id,
          leadId: lead.lead_id,
          losApplicationId: dto.los_application_id,
          status: dto.status,
          statusDate,
          correlationId: resolvedCorrelationId,
          receivedVia,
        },
        tx,
      );

      // b. Insert integration_logs (idempotency_key = dto.event_id).
      await tx
        .insertInto('integration_logs')
        .values({
          integration_log_id: randomUUID(),
          org_id: lead.org_id,
          integration: IntegrationKind.LOS_STATUS,
          direction: 'inbound',
          lead_id: lead.lead_id,
          correlation_id: resolvedCorrelationId,
          idempotency_key: dto.event_id,
          request_ref: dto.remarks ?? null,
          status: 'success',
          http_status: 200,
          completed_at: new Date(),
          created_by: SYSTEM_USER_ID,
          updated_by: SYSTEM_USER_ID,
        })
        .execute();

      // c. Audit intent (handoff_success is the closest registered action for
      //    an inbound LOS status mirror event — per FR-082 LLD §Data Operations).
      await this.audit.append(
        {
          action: AuditAction.HANDOFF_SUCCESS,
          entity_type: 'los_application_mirrors',
          entity_id: lead.lead_id,
          actor_id: SYSTEM_USER_ID,
          org_id: lead.org_id,
          lead_id: lead.lead_id,
          detail: {
            los_application_id: dto.los_application_id,
            new_status: dto.status,
            status_date: dto.status_date,
            received_via: receivedVia,
          },
        },
        tx,
      );
    });

    this.logger.info(
      { correlation_id: resolvedCorrelationId, received_via: receivedVia },
      'FR-082 status mirror updated',
    );

    return { idempotentReplay: false };
  }

  /**
   * Reconciliation batch (§14.7): poll the LOS for stale mirrors.
   *
   * Queries up to 100 handed-off leads whose mirror is absent or older than
   * RECONCILE_STALE_MINUTES. For each, calls LosPort.getApplicationStatus via
   * IntegrationGateway and processes the result as a poll event. Failures are
   * logged individually; the batch continues on partial failure.
   */
  async reconcile(): Promise<ReconcileResult> {
    const staleThreshold = new Date(Date.now() - RECONCILE_STALE_MINUTES * 60 * 1000);
    const staleLeads = await this.mirrorRepository.findStaleHandedOffLeads(staleThreshold);

    let processed = 0;
    let failed = 0;

    for (const { lead_id, los_application_id, org_id } of staleLeads) {
      const runId = randomUUID();
      const correlationId = `reconcile-${lead_id}-${runId}`;

      try {
        const result = await this.integrationGateway.call(
          this.losPort,
          {
            integration: IntegrationKind.LOS_STATUS,
            leadId: lead_id,
            correlationId,
            payload: { los_application_id },
          },
          { idempotencyKey: `los-poll-${lead_id}-${runId}` },
        );

        // The LOS response body must contain { event_id, los_application_id, status, status_date }.
        const body = result.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object') {
          this.logger.warn(
            { lead_id, correlation_id: correlationId },
            'FR-082 reconcile: LOS returned unexpected body shape — skipping',
          );
          failed += 1;
          continue;
        }

        const pollDto: LosStatusWebhookDto = {
          event_id: `poll-${los_application_id}-${runId}`,
          los_application_id,
          status: String(body['status'] ?? 'unknown'),
          status_date: String(body['status_date'] ?? new Date().toISOString()),
          correlation_id: correlationId,
          remarks: undefined,
        };

        await this.processStatusUpdate(pollDto, MirrorSource.POLL, correlationId);
        processed += 1;
      } catch (err) {
        this.logger.warn(
          { lead_id, correlation_id: correlationId },
          'FR-082 reconcile: LOS poll failed for lead — continuing batch',
        );
        // Write a failed integration_log entry for observability.
        try {
          await this.writeFailedIntegrationLog(
            {
              event_id: `poll-fail-${lead_id}-${runId}`,
              los_application_id,
              status: '',
              status_date: new Date().toISOString(),
              correlation_id: correlationId,
            },
            correlationId,
            ERROR_CODES.UPSTREAM_UNAVAILABLE,
            lead_id,
            org_id,
          );
        } catch (logErr) {
          this.logger.warn({ lead_id }, 'FR-082 reconcile: failed to write error integration_log');
        }
        failed += 1;
      }
    }

    this.logger.info({ processed, failed }, 'FR-082 reconcile batch complete');
    return { processed, failed };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async writeFailedIntegrationLog(
    dto: Pick<LosStatusWebhookDto, 'event_id' | 'los_application_id' | 'status' | 'status_date' | 'correlation_id'>,
    correlationId: string,
    errorCode: string,
    leadId: string | null = null,
    orgId: string | null = null,
  ): Promise<void> {
    // org_id is NOT NULL with a seed-org DEFAULT; set it explicitly when the lead is
    // known (reconcile path) so the row is attributed to the right org. When the lead
    // is unknown (unrecognised los_application_id) we omit it and accept the default —
    // the org genuinely cannot be resolved.
    await this.db
      .insertInto('integration_logs')
      .values({
        integration_log_id: randomUUID(),
        ...(orgId !== null ? { org_id: orgId } : {}),
        integration: IntegrationKind.LOS_STATUS,
        direction: 'inbound',
        lead_id: leadId,
        correlation_id: dto.correlation_id ?? correlationId,
        idempotency_key: dto.event_id,
        request_ref: null,
        status: 'failed',
        http_status: null,
        error_code: errorCode,
        completed_at: null,
        created_by: SYSTEM_USER_ID,
        updated_by: SYSTEM_USER_ID,
      })
      .execute();
  }
}
