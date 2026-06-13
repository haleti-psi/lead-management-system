import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  DocStatus,
  ERROR_CODES,
  KycCheckStatus,
  RoleCode,
  type ConsentPurpose,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { DomainException } from '../../core/http';
import { MaskingService } from '../../core/masking';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { DPO_VIEW_AUDIT_ACTION, DPO_VIEW_AUDIT_OP } from './workspace.constants';
import { Lead360Repository, type Lead360ConsentRow, type Lead360CoreRow } from './lead360.repository';
import type { WorkspaceScopeContext } from './lead-list.service';
import type {
  Lead360ConsentSummaryItem,
  Lead360DocumentSummary,
  Lead360Dto,
  Lead360KycSummary,
  JsonObject,
} from './dto/lead360.dto';

/**
 * FR-051 — assembles the Lead-360 aggregate (LLD §Backend Flow). Pure read
 * model: M6 writes NOTHING here; the only side-effect is the DPO access audit
 * (an `audit_logs` append via the shared {@link AuditAppender}).
 *
 * Scope is enforced IN SQL by the repository (FR-050's pattern): the core fetch
 * applies the AbacGuard-resolved predicate, so a non-existent, soft-deleted or
 * out-of-scope lead is indistinguishable — all map to 404 NOT_FOUND (existence
 * hidden, BRD §8.4; `FORBIDDEN` is never returned for an out-of-scope lead).
 *
 * Masking happens in-service (FR-050's approach; the response interceptor adds
 * a second, idempotent pass): raw `name`/`mobile`/`email` never leave this
 * service, `panMasked` is the at-rest-masked column, and the strict (DPO /
 * export) level additionally omits `dob` and reduces names to the first name.
 * DPO receives no notes (LLD: internal notes hidden unless break-glass).
 */
@Injectable()
export class Lead360Service {
  constructor(
    private readonly repo: Lead360Repository,
    private readonly masking: MaskingService,
    private readonly audit: AuditAppender,
    @InjectPinoLogger(Lead360Service.name) private readonly logger: PinoLogger,
  ) {}

  async getAggregate(user: AuthUser, leadId: string, ctx: WorkspaceScopeContext): Promise<Lead360Dto> {
    // Deny-by-default: a handler reached without an AbacGuard-resolved predicate
    // is a wiring fault — existence hidden per LLD §Error Cases; this endpoint
    // NEVER returns 403. Out-of-scope, not-found, and null-predicate all surface
    // as NOT_FOUND (404), fail-closed.
    if (!ctx.predicate) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    const core = await this.repo.fetchCore(user.orgId, ctx.predicate, leadId);
    if (!core) {
      // Not found, soft-deleted or out of scope — existence hidden (404).
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Steps 2–10 — sequential read-only child sections (LLD §Data Operations).
    const stageHistory = await this.repo.fetchStageHistory(leadId);
    const eligibility = await this.repo.fetchLatestEligibilitySnapshot(leadId);
    const losMirror = await this.repo.fetchLatestLosMirror(leadId);
    const documentCounts = await this.repo.fetchDocumentStatusCounts(leadId);
    const kycCounts = await this.repo.fetchKycStatusCounts(leadId);
    const openTaskCount = await this.repo.fetchOpenTaskCount(leadId);
    const consentRows = await this.repo.fetchConsentRows(leadId);
    const isDpo = user.role === RoleCode.DPO;
    // DPO: no notes without break-glass (LLD §Masking); PARTNER: external only.
    const notes = isDpo ? [] : await this.repo.fetchNotes(leadId, user.role === RoleCode.PARTNER);
    const duplicateMatches = await this.repo.fetchOpenDuplicateMatches(leadId, user.orgId);

    const strict = ctx.maskingLevel === 'strict';
    const dto: Lead360Dto = {
      leadId: core.lead_id,
      leadCode: core.lead_code,
      stage: core.stage,
      priority: core.priority,
      isHot: core.is_hot,
      score: core.score,
      scoreReasons: asJsonObject(core.score_reasons),
      requestedAmount: core.requested_amount,
      channelCreatedBy: core.channel_created_by,
      consentStatus: core.consent_status,
      kycStatus: core.kyc_status,
      duplicateStatus: core.duplicate_status,
      losApplicationId: core.los_application_id,
      slaFirstContactDueAt: core.sla_first_contact_due_at,
      reopenedCount: core.reopened_count,
      nurtureNextAt: core.nurture_next_at,
      createdAt: core.created_at,
      updatedAt: core.updated_at,
      version: core.version,
      identity: this.buildIdentity(core, strict),
      customerProfile:
        core.customer_profile_id != null &&
        core.display_name != null &&
        core.customer_type != null
          ? {
              customerProfileId: core.customer_profile_id,
              // The profile display name IS the customer name — same masking rule.
              displayName: this.masking.mask('full_name', core.display_name, { strict }) ?? '',
              customerType: core.customer_type,
              isExistingCustomer: core.is_existing_customer ?? false,
            }
          : null,
      sourceAttribution: {
        source: core.source,
        subSource: core.sub_source,
        partnerId: core.partner_id,
        campaignCode: core.campaign_code,
        utm: asJsonObject(core.utm),
      },
      productDetail:
        core.lead_product_detail_id != null &&
        core.product_config_id != null &&
        core.validation_status != null
          ? {
              leadProductDetailId: core.lead_product_detail_id,
              productCode: core.product_code,
              productConfigId: core.product_config_id,
              attributes: asJsonObject(core.attributes) ?? {},
              validationStatus: core.validation_status,
            }
          : null,
      branch:
        core.branch_id != null && core.branch_name != null
          ? { branchId: core.branch_id, name: core.branch_name }
          : null,
      owner:
        core.owner_id != null && core.owner_full_name != null
          ? { userId: core.owner_id, displayName: core.owner_full_name }
          : null,
      team:
        core.team_id != null && core.team_name != null
          ? { teamId: core.team_id, name: core.team_name }
          : null,
      stageHistory: stageHistory.map((row) => ({
        stageHistoryId: row.stage_history_id,
        fromStage: row.from_stage,
        toStage: row.to_stage,
        actorId: row.actor_id,
        reason: row.reason,
        occurredAt: row.occurred_at,
      })),
      eligibilitySnapshot: eligibility
        ? {
            eligibilitySnapshotId: eligibility.eligibility_snapshot_id,
            indicativeAmount: eligibility.indicative_amount,
            tenureMonths: eligibility.tenure_months,
            rateRange: eligibility.rate_range,
            conditions: asJsonObject(eligibility.conditions),
            validityUntil: eligibility.validity_until,
            status: eligibility.status,
            createdAt: eligibility.created_at,
          }
        : null,
      losApplicationMirror: losMirror
        ? {
            losMirrorId: losMirror.los_mirror_id,
            losApplicationId: losMirror.los_application_id,
            status: losMirror.status,
            statusDate: losMirror.status_date,
          }
        : null,
      documentSummary: buildDocumentSummary(documentCounts),
      kycSummary: buildKycSummary(kycCounts),
      openTaskCount,
      consentSummary: this.deduplicateConsents(consentRows),
      notes: notes.map((row) => ({
        noteId: row.note_id,
        authorId: row.author_id,
        body: row.body,
        isInternal: row.is_internal,
        createdAt: row.created_at,
      })),
      duplicateMatches: duplicateMatches.map((row) => ({
        duplicateMatchId: row.duplicate_match_id,
        matchedLeadId: row.matched_lead_id,
        matchedLeadCode: row.matched_lead_code,
        confidence: row.confidence,
        status: row.status,
        action: row.action,
      })),
      partner:
        core.partner_id != null &&
        core.partner_code != null &&
        core.partner_legal_name != null &&
        core.partner_type != null &&
        core.partner_status != null
          ? {
              partnerId: core.partner_id,
              partnerCode: core.partner_code,
              legalName: core.partner_legal_name,
              type: core.partner_type,
              status: core.partner_status,
            }
          : null,
    };

    // LLD §Auth Check 4 — every DPO access is audited after assembly. The audit
    // must never convert a successful read into a 500 (failure is logged).
    if (isDpo) {
      await this.auditDpoView(user, leadId);
    }

    return dto;
  }

  /**
   * TC-051-12 — reduce the consent rows to the latest state per purpose
   * (newest `created_at` wins; input order is not assumed).
   */
  deduplicateConsents(rows: readonly Lead360ConsentRow[]): Lead360ConsentSummaryItem[] {
    const latest = new Map<ConsentPurpose, Lead360ConsentSummaryItem>();
    const newestFirst = [...rows].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    for (const row of newestFirst) {
      if (!latest.has(row.purpose)) {
        latest.set(row.purpose, { purpose: row.purpose, state: row.state });
      }
    }
    return [...latest.values()];
  }

  /** Masked identity card; `dob` is omitted entirely under strict (DPO/export). */
  private buildIdentity(core: Lead360CoreRow, strict: boolean) {
    return {
      leadIdentityId: core.lead_identity_id,
      name: this.masking.mask('full_name', core.name, { strict }) ?? '',
      mobile: this.masking.mask('mobile', core.mobile, { strict }) ?? '',
      email: this.masking.mask('email', core.email, { strict }),
      panMasked: core.pan_masked,
      gstin: core.gstin,
      ...(strict ? {} : { dob: core.dob }),
      preferredLanguage: core.preferred_language,
    };
  }

  /** Append the DPO `view_sensitive` audit intent; log (never rethrow) sink failures. */
  private async auditDpoView(user: AuthUser, leadId: string): Promise<void> {
    try {
      await this.audit.append({
        action: DPO_VIEW_AUDIT_ACTION,
        entity_type: LEADS_RESOURCE_TYPE,
        entity_id: leadId,
        actor_id: user.userId,
        org_id: user.orgId,
        lead_id: leadId,
        detail: { op: DPO_VIEW_AUDIT_OP, role: RoleCode.DPO, masked_view: true },
      });
    } catch (cause) {
      this.logger.error({ err: cause, lead_id: leadId }, 'Failed to append DPO lead-360 view audit event');
    }
  }
}

/** Narrow a JSONB column value to an object projection (else null). */
function asJsonObject(value: unknown): JsonObject | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

/** Reduce document status counts → `{ total, verified, pending, mismatch }`. */
function buildDocumentSummary(
  rows: readonly { status: DocStatus; cnt: string }[],
): Lead360DocumentSummary {
  const summary: Lead360DocumentSummary = { total: 0, verified: 0, pending: 0, mismatch: 0 };
  for (const row of rows) {
    const count = Number(row.cnt);
    summary.total += count;
    if (row.status === DocStatus.VERIFIED) summary.verified += count;
    else if (row.status === DocStatus.PENDING) summary.pending += count;
    else if (row.status === DocStatus.MISMATCH) summary.mismatch += count;
  }
  return summary;
}

/** Reduce KYC status counts → `{ total, success, failed, exception, initiated }`. */
function buildKycSummary(
  rows: readonly { status: KycCheckStatus; cnt: string }[],
): Lead360KycSummary {
  const summary: Lead360KycSummary = { total: 0, success: 0, failed: 0, exception: 0, initiated: 0 };
  for (const row of rows) {
    const count = Number(row.cnt);
    summary.total += count;
    if (row.status === KycCheckStatus.SUCCESS) summary.success += count;
    else if (row.status === KycCheckStatus.FAILED) summary.failed += count;
    else if (row.status === KycCheckStatus.EXCEPTION) summary.exception += count;
    else if (row.status === KycCheckStatus.INITIATED) summary.initiated += count;
  }
  return summary;
}
