import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  AuditAction,
  ERROR_CODES,
  EventCode,
  KycCheckStatus,
  KycStatus,
  KycType,
  LeadStage,
  type KycException,
  type RoleCode,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { type DbTransaction, UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import {
  IntegrationGateway,
  IntegrationLogRepository,
  KYC_PORT,
  type KycPort,
} from '../../core/integration';
import { OutboxService } from '../../core/outbox';
import { LeadService } from '../capture/lead.service';
import { leadInScope } from './document.service';
import { deriveLeadKycStatus } from './kyc-status';
import { KYC_ORCHESTRATOR_ROLES, KYC_RESOURCE_TYPE } from './kyc.constants';
import {
  interpretProviderResponse,
  kycTypeToIntegrationKind,
  manualOutcome,
  type KycOutcome,
  type KycProviderPayload,
} from './kyc-provider';
import type { KycVerificationData } from './dto/kyc-verification.dto';
import type { RunKycBody } from './dto/run-kyc.dto';
import {
  KycVerificationRepository,
  type KycVerificationRow,
} from './kyc-verification.repository';

/** Caller context the controller passes alongside the validated body. */
export interface KycActorContext {
  userId: string;
  orgId: string;
  role: RoleCode;
  predicate: ScopePredicate | undefined;
  correlationId?: string;
}

/**
 * FR-071 — KYC verification orchestration (M8). Gates a lead in `kyc_in_progress`
 * on `kyc` consent, calls the provider through the {@link IntegrationGateway}
 * (idempotency, retry, breaker, integration_logs), persists only masked/tokenised
 * results, and atomically writes `kyc_verifications` + `data_sharing_logs` +
 * identity enrichment + the derived `leads.kyc_status` (via {@link LeadService} —
 * sole `leads` writer) + audit + the `KYC_EXCEPTION` outbox on failure. Raw PAN /
 * Aadhaar / biometrics are never persisted (BRD §2.4; masking in {@link kyc-provider}).
 */
@Injectable()
export class KycService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: KycVerificationRepository,
    private readonly leads: LeadService,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    private readonly gateway: IntegrationGateway,
    private readonly logRepo: IntegrationLogRepository,
    @Inject(KYC_PORT) private readonly kycPort: KycPort,
  ) {}

  async runVerification(
    leadId: string,
    kycType: KycType,
    body: RunKycBody,
    ctx: KycActorContext,
  ): Promise<KycVerificationData> {
    // 1. Role gate — verify_doc is held by RM (scope O) too, but KYC orchestration
    //    is restricted to KYC/BM (LLD §Auth; TC-006).
    if (!KYC_ORCHESTRATOR_ROLES.has(ctx.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // 2. Load lead + row-level scope check (404 / 403).
    const lead = await this.repo.getLeadForKyc(leadId, ctx.orgId);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    // partner_id is null here: KYC/BM use branch scope, and PARTNER never runs
    // KYC orchestration (role gate above), so a `partner` predicate is moot.
    if (!leadInScope({ ...lead, partner_id: null }, ctx.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // 3. Stage gate — must be in kyc_in_progress (TC-008).
    if (lead.stage !== LeadStage.KYC_IN_PROGRESS) {
      throw new DomainException(ERROR_CODES.CONFLICT);
    }

    // 4. Consent gate — active granted `kyc` consent (TC-004/005).
    const consentId = await this.repo.getActiveKycConsentId(leadId, ctx.orgId, new Date());
    if (!consentId) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'CONSENT_MISSING' },
      });
    }

    // 5. Manual type — no provider call (LLD §KycPort).
    if (kycType === KycType.MANUAL) {
      return this.persist(leadId, lead.lead_identity_id, kycType, manualOutcome(), null, consentId, ctx, {
        shareData: false,
      });
    }

    const kind = kycTypeToIntegrationKind(kycType);

    // 6. Idempotency — replay a prior success; reuse a prior log row (INV-8).
    let integrationLogId: string | undefined;
    if (body.idempotencyKey) {
      const existing = await this.repo.findIntegrationLog(body.idempotencyKey, kind);
      if (existing?.status === 'success') {
        const prior = await this.repo.getVerificationByLogId(existing.integration_log_id, ctx.orgId);
        if (prior) return this.toData(prior);
      }
      integrationLogId = existing?.integration_log_id;
    }

    // 7. Pre-create the integration log so its id lands on kyc_verifications
    //    (INV-4) — the gateway only returns {httpStatus, body, idempotent}.
    if (!integrationLogId) {
      const log = await this.logRepo.createLog({
        integration: kind,
        leadId,
        correlationId: ctx.correlationId ?? 'corr_system',
        idempotencyKey: body.idempotencyKey ?? null,
        maskedRequestRef: `kyc/${kycType}/${leadId}`,
      });
      integrationLogId = log.integration_log_id;
    }

    // 8. Provider call through the gateway (outside the write tx).
    const payload: KycProviderPayload = {
      kycType,
      pan: body.pan,
      aadhaarOfflineXml: body.aadhaarOfflineXml,
      digilockerCode: body.digilockerCode,
    };

    let outcome: KycOutcome;
    try {
      const result = await this.gateway.call(
        this.kycPort,
        {
          integration: kind,
          leadId,
          correlationId: ctx.correlationId,
          maskedRequestRef: `kyc/${kycType}/${leadId}`,
          payload,
        },
        { idempotencyKey: body.idempotencyKey, integrationLogId },
      );
      outcome = interpretProviderResponse(kycType, result.body, payload);
    } catch (cause) {
      // Provider down / breaker open — gateway threw UPSTREAM_UNAVAILABLE. Record
      // the exception verification, then re-surface 503 (FR-072 resolves it).
      const downOutcome: KycOutcome = {
        success: false,
        exceptionType: 'provider_down' as KycException,
        provider: kind,
        reference: null,
        maskedResponse: { exceptionType: 'provider_down' },
      };
      await this.persist(leadId, lead.lead_identity_id, kycType, downOutcome, integrationLogId, consentId, ctx, {
        shareData: false,
      });
      throw cause instanceof DomainException
        ? cause
        : new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE, undefined, { cause });
    }

    // 9. Persist success or business-mismatch (mismatch → 200, status failed).
    return this.persist(leadId, lead.lead_identity_id, kycType, outcome, integrationLogId, consentId, ctx, {
      shareData: true,
    });
  }

  /**
   * The atomic write: kyc_verifications + identity enrichment + data_sharing_logs
   * + derived leads.kyc_status + (KYC_EXCEPTION outbox if failed) + audit, all in
   * one UnitOfWork (LLD §Step 5 / Transaction boundary). Commit or full rollback.
   */
  private async persist(
    leadId: string,
    leadIdentityId: string,
    kycType: KycType,
    outcome: KycOutcome,
    integrationLogId: string | null,
    consentId: string,
    ctx: KycActorContext,
    opts: { shareData: boolean },
  ): Promise<KycVerificationData> {
    const row = await this.uow.run(async (tx) => {
      const verification = await this.repo.insertVerification(
        {
          kyc_verification_id: randomUUID(),
          org_id: ctx.orgId,
          lead_id: leadId,
          kyc_type: kycType,
          provider: outcome.provider,
          status: outcome.success ? KycCheckStatus.SUCCESS : KycCheckStatus.FAILED,
          reference: outcome.reference,
          masked_response: outcome.maskedResponse,
          exception_type: outcome.exceptionType,
          integration_log_id: integrationLogId,
          actor_id: ctx.userId,
        },
        tx,
      );

      if (outcome.success) {
        await this.repo.updateLeadIdentity(
          leadIdentityId,
          ctx.orgId,
          {
            ...(outcome.panToken ? { pan_token: outcome.panToken } : {}),
            ...(outcome.panMasked ? { pan_masked: outcome.panMasked } : {}),
            ...(outcome.ckycId ? { ckyc_id: outcome.ckycId } : {}),
            ...(outcome.aadhaarRefToken ? { aadhaar_ref_token: outcome.aadhaarRefToken } : {}),
          },
          ctx.userId,
          tx,
        );
      }

      // data_sharing_logs records an actual external pull (skip for manual /
      // provider-down — no data was shared).
      if (opts.shareData) {
        await this.repo.insertDataSharingLog(
          { org_id: ctx.orgId, lead_id: leadId, recipient: outcome.provider, consent_id: consentId, actor_id: ctx.userId },
          tx,
        );
      }

      const kycStatus = await this.computeLeadKycStatus(leadId, ctx.orgId, tx);
      await this.leads.setKycStatus(leadId, kycStatus, tx);

      if (!outcome.success) {
        await this.outbox.emit(
          {
            event_code: EventCode.KYC_EXCEPTION,
            aggregate_type: 'kyc_verifications',
            aggregate_id: verification.kyc_verification_id,
            payload: { leadId, kycVerificationId: verification.kyc_verification_id, exceptionType: outcome.exceptionType },
          },
          tx,
        );
      }

      await this.audit.append(
        {
          action: AuditAction.KYC_RESPONSE,
          entity_type: KYC_RESOURCE_TYPE,
          entity_id: verification.kyc_verification_id,
          actor_id: ctx.userId,
          org_id: ctx.orgId,
          lead_id: leadId,
          detail: { kycType, status: verification.status, exceptionType: outcome.exceptionType },
        },
        tx,
      );

      return verification;
    });

    return this.toData(row);
  }

  /**
   * Derive `leads.kyc_status` from all of the lead's KYC verifications
   * (shared {@link deriveLeadKycStatus}). Read inside the tx so the just-inserted
   * row counts.
   */
  private async computeLeadKycStatus(
    leadId: string,
    orgId: string,
    tx: DbTransaction,
  ): Promise<KycStatus> {
    const rows = await this.repo.listByLead(leadId, orgId, tx);
    return deriveLeadKycStatus(rows);
  }

  /** Map a row to the masked response DTO (never exposes tokens — TC-017). */
  private toData(row: KycVerificationRow): KycVerificationData {
    return {
      kycVerificationId: row.kyc_verification_id,
      leadId: row.lead_id,
      kycType: row.kyc_type,
      status: row.status,
      reference: row.reference,
      maskedResponse: (row.masked_response as Record<string, unknown> | null) ?? null,
      exceptionType: row.exception_type,
      createdAt: row.created_at,
    };
  }
}
