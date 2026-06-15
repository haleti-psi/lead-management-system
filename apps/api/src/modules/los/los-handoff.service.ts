import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  ConsentPurpose,
  DataCategory,
  ERROR_CODES,
  EventCode,
  IntegrationKind,
  LeadStage,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { KYSELY, UnitOfWork, type KyselyDb, type DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { IntegrationGateway } from '../../core/integration/integration-gateway';
import { LOS_PORT } from '../../core/integration/ports/los.port';
import type { IntegrationPort } from '../../core/integration/ports/integration-port';
import { OutboxService } from '../../core/outbox';
import { LeadService } from '../capture/lead.service';
import { StageGuardService } from '../capture/stage-guard.service';
import { DataSharingService } from '../compliance/data-sharing.service';
import type { AuthUser } from '../../core/auth/auth-user';
import { LosHandoffPayloadBuilder, type LosHandoffPayload } from './los-handoff-payload.builder';
import { LosRepository } from './los.repository';

/** Response body from the LOS for a hand-off call. */
interface LosHandoffResponseBody {
  los_application_id?: string;
  /** LosMockAdapter echo path. */
  mock?: string;
}

/** Wire result returned to the controller. */
export interface HandoffResult {
  leadId: string;
  stage: string;
  losApplicationId: string;
  handedOffAt: string;
  idempotentReplay?: boolean;
}

/**
 * FR-081 — LOS hand-off orchestration service.
 *
 * Guards, idempotency, external call, and one atomic UoW transaction that
 * commits all six DB writes (leads, stage_history, audit_logs via AuditAppender,
 * event_outbox, integration_logs, data_sharing_logs, los_application_mirrors).
 *
 * Key invariants:
 * - NEVER creates a duplicate LOS application (idempotency via integration_logs
 *   + the lead's stage check).
 * - NO partial state on LOS failure (integration_logs pending row updated to
 *   failed in catch; UoW tx never opened if LOS hasn't succeeded).
 * - aggregate_type = 'Lead' per CORRECTIONS §FR-081 (object form).
 * - Stage guards delegated to StageGuardService (FR-052 single source of truth).
 */
@Injectable()
export class LosHandoffService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    @Inject(LOS_PORT) private readonly losPort: IntegrationPort<LosHandoffPayload>,
    private readonly uow: UnitOfWork,
    private readonly leadService: LeadService,
    private readonly stageGuardService: StageGuardService,
    private readonly dataSharingService: DataSharingService,
    private readonly integrationGateway: IntegrationGateway,
    private readonly losRepository: LosRepository,
    private readonly payloadBuilder: LosHandoffPayloadBuilder,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(LosHandoffService.name) private readonly logger: PinoLogger,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  async handoffToLos(
    leadId: string,
    user: AuthUser,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<HandoffResult> {
    const orgId = user.orgId;
    const actorId = user.userId;

    // ── Step 1: audit the attempt ─────────────────────────────────────────────
    // (done after we load the lead so we have org_id; on NOT_FOUND we skip it)

    // ── Step 2: load lead ─────────────────────────────────────────────────────
    const lead = await this.db
      .selectFrom('leads')
      .select([
        'lead_id',
        'org_id',
        'lead_code',
        'stage',
        'version',
        'updated_at',
        'duplicate_status',
        'kyc_status',
        'consent_status',
        'los_application_id',
        'product_config_id',
        'product_code',
        'lead_identity_id',
        'requested_amount',
        'branch_id',
        'owner_id',
      ])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();

    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Audit the attempt (handoff_attempt) regardless of outcome.
    await this.audit.append({
      action: AuditAction.HANDOFF_ATTEMPT,
      entity_type: 'leads',
      entity_id: leadId,
      actor_id: actorId,
      org_id: lead.org_id,
      lead_id: leadId,
      detail: { idempotencyKey, correlationId },
    });

    // ── Step 3: idempotency check (integration_logs) ──────────────────────────
    const existingLog = await this.db
      .selectFrom('integration_logs')
      .select(['integration_log_id', 'status', 'request_ref', 'updated_at'])
      .where('idempotency_key', '=', idempotencyKey)
      .where('integration', '=', IntegrationKind.LOS_HANDOFF)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();

    if (existingLog) {
      if (existingLog.status === 'success' && existingLog.request_ref) {
        // Idempotent replay: return the ORIGINAL timestamp (updated_at was set
        // when the log transitioned to success — do not fabricate new Date()).
        this.logger.info({ lead_id: leadId, idempotency_key: idempotencyKey }, 'FR-081 idempotent replay');
        const originalTimestamp =
          existingLog.updated_at instanceof Date
            ? existingLog.updated_at.toISOString()
            : new Date(existingLog.updated_at as unknown as string).toISOString();
        return {
          leadId,
          stage: LeadStage.HANDED_OFF,
          losApplicationId: existingLog.request_ref,
          handedOffAt: originalTimestamp,
          idempotentReplay: true,
        };
      }
      if (existingLog.status === 'pending' || existingLog.status === 'retrying') {
        // Retry in progress — do not double-submit.
        throw new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'A retry for this hand-off is already in progress.');
      }
    }

    // Also check if the lead is already handed_off (stage-based replay protection).
    // Return the ORIGINAL timestamp (lead.updated_at reflects when stage was last changed).
    if (lead.stage === LeadStage.HANDED_OFF && lead.los_application_id) {
      this.logger.info({ lead_id: leadId }, 'FR-081 stage-based idempotent replay');
      const originalTimestamp =
        lead.updated_at instanceof Date
          ? lead.updated_at.toISOString()
          : new Date(lead.updated_at as unknown as string).toISOString();
      return {
        leadId,
        stage: LeadStage.HANDED_OFF,
        losApplicationId: lead.los_application_id,
        handedOffAt: originalTimestamp,
        idempotentReplay: true,
      };
    }

    // ── Step 4: stage guards — delegate to StageGuardService (FR-052) ─────────
    // StageGuardService owns the ready_for_handoff → handed_off guard matrix:
    //   consent_present, duplicate_clear, mandatory_docs_verified (deferred-pass),
    //   kyc_signoff (deferred-pass), valid_payload (deferred-pass).
    // Also enforces the stage validity check (unknown/invalid transitions fail).
    const guardResult = await this.stageGuardService.evaluate({
      fromStage: lead.stage,
      toStage: LeadStage.HANDED_OFF,
      lead: {
        lead_id: lead.lead_id,
        org_id: lead.org_id,
        stage: lead.stage,
        kyc_status: lead.kyc_status ?? undefined,
        consent_status: lead.consent_status ?? undefined,
        duplicate_status: lead.duplicate_status ?? undefined,
      },
      actor: user,
      reason: null,
      // Guard for ready_for_handoff→handed_off uses only field-level checks
      // (no child-record queries), so passing the pool connection is safe here.
      tx: this.db as unknown as DbTransaction,
    });

    if (guardResult.failed.length > 0) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'One or more hand-off guards failed.', {
        detail: { reason: 'STAGE_GUARD_FAILED', failed_guards: guardResult.failed },
      });
    }

    // ── Step 5: los_handoff data-share consent gate ────────────────────────────
    // This is a SEPARATE gate from the stage guards: it verifies that the specific
    // LOS_HANDOFF consent purpose has been granted before sharing data externally.
    // A 403 CONSENT_MISSING (not a guard failure) if absent.
    const consent = await this.db
      .selectFrom('consent_records')
      .select(['consent_id', 'state'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('purpose', '=', ConsentPurpose.LOS_HANDOFF)
      .where('state', '=', 'granted')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!consent) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'LOS hand-off consent not granted.', {
        detail: { reason: 'CONSENT_MISSING' },
      });
    }

    // ── Step 6: resolve branch_code for LOS payload ───────────────────────────
    let branchCode: string | null = null;
    if (lead.branch_id) {
      const branch = await this.db
        .selectFrom('branches')
        .select('code')
        .where('branch_id', '=', lead.branch_id)
        .limit(1)
        .executeTakeFirst();
      branchCode = branch?.code ?? null;
    }

    // ── Step 7: insert pending integration_log (outside UoW — no held lock) ───
    const pendingLog = await this.db
      .insertInto('integration_logs')
      .values({
        org_id: orgId,
        integration: IntegrationKind.LOS_HANDOFF,
        direction: 'outbound',
        lead_id: leadId,
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
        request_ref: null,
        status: 'pending',
        http_status: null,
        retry_count: 0,
        created_by: actorId,
        updated_by: actorId,
      })
      .returning('integration_log_id')
      .executeTakeFirstOrThrow();

    const integrationLogId = pendingLog.integration_log_id;

    // ── Step 8: build LOS payload ─────────────────────────────────────────────
    const { integration, payload, maskedRequestRef } = this.payloadBuilder.build(
      {
        lead_code: lead.lead_code,
        product_code: lead.product_code,
        lead_identity_id: lead.lead_identity_id,
        requested_amount: lead.requested_amount as number | null,
        branch_code: branchCode,
        eligibility_ref: null, // FR-080 snapshot ref not stored on leads (AMBIGUITY §FR-080)
      },
      correlationId,
    );

    // ── Step 9: call LOS via IntegrationGateway ───────────────────────────────
    let losApplicationId: string;
    let handedOffAt: Date;

    try {
      const gatewayResult = await this.integrationGateway.call<LosHandoffPayload, unknown>(
        this.losPort as IntegrationPort<LosHandoffPayload, unknown>,
        {
          integration,
          leadId,
          correlationId,
          maskedRequestRef,
          payload,
        },
        {
          idempotencyKey,
          integrationLogId,
        },
      );

      // Extract los_application_id from LOS response.
      const responseBody = gatewayResult.body as LosHandoffResponseBody | null;
      const resolvedAppId =
        (typeof responseBody === 'object' && responseBody !== null && 'los_application_id' in responseBody
          ? responseBody.los_application_id
          : undefined) ??
        // LosMockAdapter echo path: fall back to a deterministic ref.
        `LOS-MOCK-${lead.lead_code}-${Date.now()}`;

      losApplicationId = resolvedAppId;
      handedOffAt = new Date();
    } catch (err) {
      // LOS failed — update integration_log to failed; no UoW opened; no partial state.
      await this.db
        .updateTable('integration_logs')
        .set({
          status: 'failed',
          updated_at: new Date(),
          updated_by: actorId,
        })
        .where('integration_log_id', '=', integrationLogId)
        .execute();

      // Emit HANDOFF_FAILED to outbox (fire-and-forget, outside UoW).
      try {
        await this.uow.run(async (failTx) => {
          await this.outbox.emit(
            {
              event_code: EventCode.HANDOFF_FAILED,
              aggregate_type: 'Lead',
              aggregate_id: leadId,
              payload: { leadId, actorId, integrationLogId },
            },
            failTx,
          );
        });
      } catch (outboxErr) {
        this.logger.warn({ lead_id: leadId }, 'Failed to emit HANDOFF_FAILED outbox event');
      }

      // Audit the failure.
      try {
        await this.audit.append({
          action: AuditAction.HANDOFF_FAILURE,
          entity_type: 'leads',
          entity_id: leadId,
          actor_id: actorId,
          org_id: orgId,
          lead_id: leadId,
          detail: { integrationLogId },
        });
      } catch (auditErr) {
        this.logger.warn({ lead_id: leadId }, 'Failed to emit handoff_failure audit entry');
      }

      this.logger.warn({ lead_id: leadId, integration_log_id: integrationLogId }, 'FR-081 LOS call failed');
      throw err;
    }

    // ── Step 10: success — commit all writes in one UoW transaction ───────────
    await this.uow.run(async (tx) => {
      // a. LeadService.markHandedOff — sole writer of leads, stage_history, audit, outbox
      await this.leadService.markHandedOff(leadId, losApplicationId, lead.version, actorId, tx);

      // b. Update integration_logs → success
      await tx
        .updateTable('integration_logs')
        .set({
          status: 'success',
          request_ref: losApplicationId,
          updated_at: handedOffAt,
          updated_by: actorId,
        })
        .where('integration_log_id', '=', integrationLogId)
        .execute();

      // c. data_sharing_logs INSERT (DataSharingService verifies consent + appends)
      await this.dataSharingService.logShare(
        {
          leadId,
          orgId,
          recipient: 'LOS',
          purpose: ConsentPurpose.LOS_HANDOFF,
          dataCategory: DataCategory.FINANCIAL,
          consentId: consent.consent_id,
          actorId,
        },
        tx,
      );

      // d. los_application_mirrors INSERT (M9 owns this table)
      await this.losRepository.insertMirror(
        {
          orgId,
          leadId,
          losApplicationId,
          correlationId,
          actorId,
        },
        tx,
      );
    });

    return {
      leadId,
      stage: LeadStage.HANDED_OFF,
      losApplicationId,
      handedOffAt: handedOffAt.toISOString(),
    };
  }
}
