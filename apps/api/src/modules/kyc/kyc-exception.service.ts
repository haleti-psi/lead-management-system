import { Injectable } from '@nestjs/common';

import {
  AuditAction,
  ERROR_CODES,
  EventCode,
  KycCheckStatus,
  type RoleCode,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { LeadService } from '../capture/lead.service';
import { leadInScope } from './document.service';
import { deriveLeadKycStatus } from './kyc-status';
import {
  KYC_RESOURCE_TYPE,
  KYC_SIGNOFF_ROLES,
  MANUAL_FALLBACK_FLAG,
  WAIVER_RESOLUTION_CODES,
} from './kyc.constants';
import { KycVerificationRepository } from './kyc-verification.repository';
import type { ResolveKycExceptionDto } from './dto/resolve-kyc-exception.dto';
import type { ResolveKycExceptionData } from './dto/kyc-verification.dto';

/** Caller context the controller passes alongside the validated body. */
export interface KycExceptionActorContext {
  userId: string;
  orgId: string;
  role: RoleCode;
  predicate: ScopePredicate | undefined;
}

/** Open-exception statuses FR-072 may resolve. FR-071 persists provider
 * mismatch/down as `failed` (+ exception_type); the `failed→exception` consumer
 * is unbuilt (AMBIGUITY FR-072-A4), so both count as the resolvable open state. */
const OPEN_EXCEPTION_STATUSES: ReadonlySet<KycCheckStatus> = new Set([
  KycCheckStatus.EXCEPTION,
  KycCheckStatus.FAILED,
]);

/**
 * FR-072 — KYC exception resolution (M8). Resolves an open `kyc_verifications`
 * exception (KYC/BM, branch-scoped) and atomically updates the row + derived
 * `leads.kyc_status` (via {@link LeadService}) + the `KYC_EXCEPTION` outbox + the
 * audit intent in one {@link UnitOfWork}. There is no `resolved` enum value
 * (A-5): waiver codes map to `waived`, all others to `success`.
 */
@Injectable()
export class KycExceptionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: KycVerificationRepository,
    private readonly leads: LeadService,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
  ) {}

  async resolve(
    leadId: string,
    kycVerificationId: string,
    dto: ResolveKycExceptionDto,
    ctx: KycExceptionActorContext,
  ): Promise<ResolveKycExceptionData> {
    // 1. Role gate — kyc_signoff is held by KYC/BM (and DPO scope M); exception
    //    resolution is restricted to KYC/BM (LLD §Auth).
    if (!KYC_SIGNOFF_ROLES.has(ctx.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // 2. Load lead + row-level branch-scope check.
    const lead = await this.repo.getLeadForKyc(leadId, ctx.orgId);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (!leadInScope({ ...lead, partner_id: null }, ctx.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // 3. Load the verification (404) and assert it is an open exception (409).
    const verification = await this.repo.getById(kycVerificationId, leadId, ctx.orgId);
    if (!verification) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (!OPEN_EXCEPTION_STATUSES.has(verification.status) || verification.resolution_code !== null) {
      throw new DomainException(ERROR_CODES.CONFLICT);
    }

    // 4. Compliance-flag gate for provider_down_manual (post-auth business rule).
    if (dto.resolutionCode === 'provider_down_manual') {
      const enabled = await this.repo.isManualFallbackEnabled(
        lead.product_config_id,
        ctx.orgId,
        MANUAL_FALLBACK_FLAG,
      );
      if (!enabled) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
    }

    const newStatus = WAIVER_RESOLUTION_CODES.has(dto.resolutionCode)
      ? KycCheckStatus.WAIVED
      : KycCheckStatus.SUCCESS;

    await this.uow.run(async (tx) => {
      const updated = await this.repo.resolveException(
        {
          kyc_verification_id: kycVerificationId,
          org_id: ctx.orgId,
          new_status: newStatus,
          resolution_code: dto.resolutionCode,
          actor_id: ctx.userId,
        },
        tx,
      );
      // Concurrency guard — a parallel resolve already closed it.
      if (updated === 0) {
        throw new DomainException(ERROR_CODES.CONFLICT);
      }

      // Recompute leads.kyc_status from all rows (verified/waived once the last
      // open exception is closed; unchanged while others remain — T-16).
      const rows = await this.repo.listByLead(leadId, ctx.orgId, tx);
      await this.leads.setKycStatus(leadId, deriveLeadKycStatus(rows), tx);

      await this.outbox.emit(
        {
          event_code: EventCode.KYC_EXCEPTION,
          aggregate_type: 'kyc_verifications',
          aggregate_id: kycVerificationId,
          payload: {
            leadId,
            kycVerificationId,
            resolutionCode: dto.resolutionCode,
            resolvedBy: ctx.userId,
          },
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.KYC_EXCEPTION,
          entity_type: KYC_RESOURCE_TYPE,
          entity_id: kycVerificationId,
          actor_id: ctx.userId,
          org_id: ctx.orgId,
          lead_id: leadId,
          // Never log the raw remarks text (may carry PII) — record presence only.
          detail: { resolutionCode: dto.resolutionCode, remarks: '[present]' },
        },
        tx,
      );
    });

    return {
      kycVerificationId,
      leadId,
      kycType: verification.kyc_type,
      status: newStatus,
      exceptionType: verification.exception_type,
      resolutionCode: dto.resolutionCode,
      updatedAt: new Date(),
    };
  }
}
