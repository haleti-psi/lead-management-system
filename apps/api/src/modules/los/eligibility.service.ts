import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  ConsentPurpose,
  DataCategory,
  ERROR_CODES,
  EventCode,
  IntegrationKind,
  LeadStage,
} from '@lms/shared';

import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import type { DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { IntegrationGateway } from '../../core/integration/integration-gateway';
import { LOS_PORT } from '../../core/integration/ports/los.port';
import type { IntegrationPort } from '../../core/integration/ports/integration-port';
import { OutboxService } from '../../core/outbox';
import { LeadService } from '../capture/lead.service';
import { DataSharingService } from '../compliance/data-sharing.service';
import type { AuthUser } from '../../core/auth/auth-user';
import { EligibilityMappingValidator } from './eligibility-mapping.validator';
import { EligibilityPayloadBuilder, type LosEligibilityPayload } from './eligibility-payload.builder';
import { EligibilityRepository, type EligibilitySnapshotRow } from './eligibility.repository';

/** The LOS eligibility response body shape (decoded from gateway result.body). */
interface LosEligibilityResponseBody {
  requestRef?: string;
  indicativeAmount?: string | null;
  tenureMonths?: number | null;
  rateRange?: string | null;
  conditions?: Record<string, unknown> | null;
  validityUntil?: string | null;
  responseBasis?: 'indicative' | 'preliminary' | 'final';
}

/** The wire shape returned to the controller. */
export interface EligibilityResult {
  eligibilitySnapshotId: string;
  leadId: string;
  requestRef: string;
  status: string;
  indicativeAmount: string | null;
  tenureMonths: number | null;
  rateRange: string | null;
  conditions: Record<string, unknown> | null;
  validityUntil: string | null;
  responseBasis: string | null;
  createdAt: string;
  idempotentReplay?: boolean;
}

/**
 * FR-080 — Eligibility orchestration service.
 *
 * Orchestrates the full eligibility request flow:
 * 1. Load and validate lead
 * 2. Consent check (FORBIDDEN + CONSENT_MISSING if absent)
 * 3. Load ProductConfig eligibility_mapping + validate
 * 4. Load LeadProductDetail attributes
 * 5. Idempotency check against integration_logs
 * 6. Atomic UoW: insert snapshot (pending) + integration_log + transitionStage +
 *    data_sharing_log (via DataSharingService.logShare)
 * 7. Call LOS via IntegrationGateway.call(LosPort, …) [post-commit]
 * 8. Update snapshot on success; set failed + throw 503 on 5xx
 */
@Injectable()
export class EligibilityService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    @Inject(LOS_PORT) private readonly losPort: IntegrationPort<LosEligibilityPayload>,
    private readonly uow: UnitOfWork,
    private readonly leadService: LeadService,
    private readonly dataSharingService: DataSharingService,
    private readonly integrationGateway: IntegrationGateway,
    private readonly eligibilityRepo: EligibilityRepository,
    private readonly mappingValidator: EligibilityMappingValidator,
    private readonly payloadBuilder: EligibilityPayloadBuilder,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(EligibilityService.name) private readonly logger: PinoLogger,
  ) {}

  async requestEligibility(
    leadId: string,
    user: AuthUser,
    idempotencyKey: string | undefined,
    correlationId: string,
  ): Promise<EligibilityResult> {
    const orgId = user.orgId;
    const actorId = user.userId;

    // ── 1. Load lead ──────────────────────────────────────────────────────────
    const lead = await this.db
      .selectFrom('leads')
      .select([
        'lead_id',
        'org_id',
        'lead_code',
        'stage',
        'kyc_status',
        'product_config_id',
        'channel_created_by',
        'owner_id',
        'branch_id',
        'version',
        'deleted_at',
      ])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();

    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // ── 2. Stage guard — delegated to transitionStage (step 9c) which calls
    //      StageGuardService internally. The guard matrix is the single source
    //      of truth; no inline literal check here (MINOR-4 fix).
    // ── 3. Consent check: product_eligibility must be granted ─────────────────
    const consent = await this.db
      .selectFrom('consent_records')
      .select(['consent_id', 'state', 'expires_at'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('purpose', '=', ConsentPurpose.PRODUCT_ELIGIBILITY)
      .where('state', '=', 'granted')
      .where((eb) =>
        eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', new Date())]),
      )
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!consent) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'CONSENT_MISSING' },
      });
    }

    // ── 4. Load ProductConfig eligibility_mapping ─────────────────────────────
    const productConfig = await this.db
      .selectFrom('product_configs')
      .select(['product_config_id', 'eligibility_mapping', 'product_code'])
      .where('product_config_id', '=', lead.product_config_id)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();

    if (!productConfig) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Product configuration not found.');
    }

    // ── 5. Load LeadProductDetail attributes ──────────────────────────────────
    const lpd = await this.db
      .selectFrom('lead_product_details')
      .select(['attributes', 'validation_status'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();

    const attributes = (lpd?.attributes ?? {}) as Record<string, unknown>;

    // ── 6. Validate mapping completeness ─────────────────────────────────────
    const eligibilityMapping = productConfig.eligibility_mapping as Record<string, string> | null;
    this.mappingValidator.validate({
      eligibilityMapping,
      productCode: productConfig.product_code,
      attributes,
    });

    const safeMapping = eligibilityMapping as Record<string, string>;

    // ── 7. Idempotency check (integration_logs) ──────────────────────────────
    if (idempotencyKey) {
      const existing = await this.db
        .selectFrom('integration_logs')
        .select(['integration_log_id', 'status', 'request_ref'])
        .where('idempotency_key', '=', idempotencyKey)
        .where('integration', '=', IntegrationKind.LOS_ELIGIBILITY)
        .where('org_id', '=', orgId)
        .limit(1)
        .executeTakeFirst();

      if (existing && (existing.status === 'success' || existing.status === 'pending') && existing.request_ref) {
        // Return the existing snapshot for this idempotency key
        const existingSnapshot = await this.eligibilityRepo.findSnapshotByRequestRef(
          existing.request_ref,
          orgId,
        );
        if (existingSnapshot) {
          return {
            ...this.toResult(existingSnapshot),
            idempotentReplay: true,
          };
        }
      }
    }

    // ── 8. Build request ref and LOS payload ─────────────────────────────────
    const requestRef = `ELIG-${lead.lead_code}-${Date.now()}`;
    const losPayload = this.payloadBuilder.build(
      {
        leadCode: lead.lead_code,
        productCode: productConfig.product_code,
        sourceChannel: lead.channel_created_by,
        kycStatus: lead.kyc_status,
        consentRef: consent.consent_id,
        eligibilityMapping: safeMapping,
        attributes,
      },
      requestRef,
    );

    // ── 9. Atomic UoW transaction ─────────────────────────────────────────────
    let snapshot: EligibilitySnapshotRow;
    let integrationLogId: string;

    ({ snapshot, integrationLogId } = await this.uow.run(async (tx) => {
      // 9a. INSERT eligibility_snapshots (status = pending)
      const snap = await this.eligibilityRepo.insertSnapshot(
        { org_id: orgId, lead_id: leadId, request_ref: requestRef, created_by: actorId },
        tx,
      );

      // 9b. INSERT integration_logs (status = pending)
      const logRow = await this.insertIntegrationLog(
        {
          orgId,
          leadId,
          correlationId,
          idempotencyKey: idempotencyKey ?? null,
          requestRef,
          actorId,
        },
        tx,
      );

      // 9c. Transition lead stage via LeadService (sole writer of leads)
      await this.leadService.transitionStage(
        leadId,
        LeadStage.ELIGIBILITY_REQUESTED,
        {
          actor_id: actorId,
          from_stage: LeadStage.KYC_IN_PROGRESS,
          reason: `Eligibility requested (ref: ${requestRef})`,
        },
        lead.version,
        tx,
      );

      // 9d. Data sharing log (FR-111 seam, append-only, within UoW tx)
      await this.dataSharingService.logShare(
        {
          leadId,
          orgId,
          recipient: 'LOS',
          purpose: ConsentPurpose.PRODUCT_ELIGIBILITY,
          dataCategory: DataCategory.FINANCIAL,
          consentId: consent.consent_id,
          actorId,
        },
        tx,
      );

      // 9e. Record eligibility reference on the lead (LLD §11.2 pinned mutator,
      //     shared-utilities.md). Emits an audit entry linking this lead to the
      //     snapshot ref atomically within the same UoW (schema.sql has no
      //     eligibility_snapshot_ref column — see AMBIGUITY.md §FR-080).
      await this.leadService.recordEligibility(leadId, snap.eligibility_snapshot_id, tx);

      return { snapshot: snap, integrationLogId: logRow.integration_log_id };
    }));

    // ── 10. Call LOS via IntegrationGateway (post-commit) ────────────────────
    let gatewayResult: { httpStatus: number; body: unknown; idempotent: boolean } | undefined;
    let losCallFailed = false;

    try {
      gatewayResult = await this.integrationGateway.call(
        this.losPort,
        {
          integration: IntegrationKind.LOS_ELIGIBILITY,
          leadId,
          correlationId,
          maskedRequestRef: requestRef,
          payload: losPayload,
        },
        {
          idempotencyKey: requestRef,
          integrationLogId,
        },
      );
    } catch (err) {
      // IntegrationGateway throws DomainException(UPSTREAM_UNAVAILABLE) on 5xx/transport fault.
      // Update snapshot to failed before re-throwing.
      losCallFailed = true;

      await this.eligibilityRepo.updateSnapshotStatus(
        snapshot.eligibility_snapshot_id,
        orgId,
        { status: 'failed' },
        actorId,
      );

      this.logger.warn(
        { lead_id: leadId, request_ref: requestRef },
        'LOS eligibility call failed; snapshot marked failed',
      );
      throw err;
    }

    if (!losCallFailed && gatewayResult) {
      const isSuccess = gatewayResult.httpStatus >= 200 && gatewayResult.httpStatus < 300;

      if (isSuccess) {
        // ── 11a. Success: update snapshot with LOS response fields ────────────
        const losBody = gatewayResult.body as LosEligibilityResponseBody;

        const validityUntil = losBody.validityUntil ? new Date(losBody.validityUntil) : null;

        await this.eligibilityRepo.updateSnapshotStatus(
          snapshot.eligibility_snapshot_id,
          orgId,
          {
            status: 'received',
            indicative_amount: losBody.indicativeAmount ?? null,
            tenure_months: losBody.tenureMonths ?? null,
            rate_range: losBody.rateRange ?? null,
            conditions: losBody.conditions ?? null,
            validity_until: validityUntil,
            response_basis: losBody.responseBasis ?? 'indicative',
          },
          actorId,
        );

        // Update our snapshot in memory for the response
        snapshot = {
          ...snapshot,
          status: 'received',
          indicative_amount: losBody.indicativeAmount ?? null,
          tenure_months: losBody.tenureMonths ?? null,
          rate_range: losBody.rateRange ?? null,
          conditions: losBody.conditions ?? null,
          validity_until: validityUntil,
          response_basis: losBody.responseBasis ?? 'indicative',
        };

        // Emit ELIGIBILITY_RECEIVED outbox event in a standalone UoW transaction
        // (post-commit; no DB connection held during the LOS call — LLD §Transaction boundary).
        await this.uow.run(async (outboxTx) => {
          await this.outbox.emit(
            {
              event_code: EventCode.ELIGIBILITY_RECEIVED,
              aggregate_type: 'eligibility_snapshot',
              aggregate_id: snapshot.eligibility_snapshot_id,
              payload: {
                leadId,
                snapshotId: snapshot.eligibility_snapshot_id,
                status: 'received',
              },
            },
            outboxTx,
          );
        });
      }
      // timeout: snapshot stays pending — IntegrationGateway enqueued retry
    }

    return this.toResult(snapshot);
  }

  /** Insert a pending integration_log row inside the caller's tx. */
  private async insertIntegrationLog(
    input: {
      orgId: string;
      leadId: string;
      correlationId: string;
      idempotencyKey: string | null;
      requestRef: string;
      actorId: string;
    },
    tx: DbTransaction,
  ): Promise<{ integration_log_id: string }> {
    const row = await tx
      .insertInto('integration_logs')
      .values({
        org_id: input.orgId,
        integration: IntegrationKind.LOS_ELIGIBILITY,
        direction: 'outbound',
        lead_id: input.leadId,
        correlation_id: input.correlationId,
        idempotency_key: input.idempotencyKey,
        request_ref: input.requestRef,
        status: 'pending',
        created_by: input.actorId,
        updated_by: input.actorId,
      })
      .returning('integration_log_id')
      .executeTakeFirstOrThrow();

    return { integration_log_id: row.integration_log_id };
  }

  /** Map a snapshot row to the wire result shape. */
  private toResult(snapshot: EligibilitySnapshotRow): EligibilityResult {
    return {
      eligibilitySnapshotId: snapshot.eligibility_snapshot_id,
      leadId: snapshot.lead_id,
      requestRef: snapshot.request_ref,
      status: snapshot.status,
      indicativeAmount: snapshot.indicative_amount ?? null,
      tenureMonths: snapshot.tenure_months ?? null,
      rateRange: snapshot.rate_range ?? null,
      conditions: (snapshot.conditions as Record<string, unknown> | null) ?? null,
      validityUntil: snapshot.validity_until?.toISOString() ?? null,
      responseBasis: snapshot.response_basis ?? null,
      createdAt: snapshot.created_at.toISOString(),
    };
  }
}
