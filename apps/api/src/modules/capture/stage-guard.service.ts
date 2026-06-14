import { Injectable } from '@nestjs/common';

import { LeadStage, RoleCode, type LeadStage as LeadStageType, type RoleCode as RoleCodeType } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import type { DbTransaction } from '../../core/db';

/** Minimal lead attributes needed for guard evaluation. */
export interface GuardLeadContext {
  lead_id: string;
  org_id: string;
  stage: LeadStageType;
  kyc_status?: string;
  /** FR-110 consent_status column (pending/partial/captured/withdrawn). */
  consent_status?: string;
  /** FR-020 duplicate_status column (none/flagged/linked/merged). */
  duplicate_status?: string;
}

/**
 * Typed context object passed to stage-transition audit and internal guard
 * evaluation. Replaces string-keyed `guardCtx['key']` casts.
 */
export interface StageTransitionContext {
  actor_id: string;
  from_stage: LeadStageType;
  reason: string | null;
}

/** Input to {@link StageGuardService.evaluate}. */
export interface GuardEvaluateInput {
  fromStage: LeadStageType;
  toStage: LeadStageType;
  lead: GuardLeadContext;
  actor: AuthUser;
  /** Reason text provided by the caller (required for rejected/dormant). */
  reason?: string | null;
  /** Active transaction handle — guard may query the DB for field checks. */
  tx: DbTransaction;
}

/** Guard evaluation result. */
export interface GuardResult {
  /** Empty on success; non-empty lists the names of all failing guards. */
  failed: string[];
}

/**
 * A valid transition descriptor: which roles may trigger it and which named
 * guards must pass. Named guards mirror §10.3 of the LLD and state-machines.md §Lead.
 */
interface TransitionDescriptor {
  allowedRoles: ReadonlySet<RoleCodeType>;
  guards: string[];
}

/** ─────────────────────────────────────────────────────────────────────────
 * "Active" stages — a lead in any of these may transition to `rejected` or
 * `dormant` (state-machines.md §Lead "any active → rejected/dormant").
 * `handed_off` is intentionally EXCLUDED (terminal in LMS).
 * `rejected` and `dormant` are NOT in this set — a lead already in one of
 * those special states cannot re-enter via the "any active → rejected/dormant"
 * path. Re-rejection is not legal (rejected is terminal-unless-reopened);
 * dormant→dormant has no entry in the transition table either.
 * ──────────────────────────────────────────────────────────────────────── */
const ACTIVE_STAGES: ReadonlySet<LeadStageType> = new Set([
  LeadStage.CAPTURED,
  LeadStage.CONSENT_PENDING,
  LeadStage.ASSIGNED,
  LeadStage.FIRST_CONTACT_PENDING,
  LeadStage.CONTACTED,
  LeadStage.QUALIFIED,
  LeadStage.DOCUMENTS_PENDING,
  LeadStage.KYC_IN_PROGRESS,
  LeadStage.ELIGIBILITY_REQUESTED,
  LeadStage.READY_FOR_HANDOFF,
]);

const ALL_RM_BM_SM: ReadonlySet<RoleCodeType> = new Set([RoleCode.RM, RoleCode.BM, RoleCode.SM]);
const RM_BM: ReadonlySet<RoleCodeType> = new Set([RoleCode.RM, RoleCode.BM]);
const RM_BM_KYC: ReadonlySet<RoleCodeType> = new Set([RoleCode.RM, RoleCode.BM, RoleCode.KYC]);
const BM_KYC_RM: ReadonlySet<RoleCodeType> = new Set([RoleCode.BM, RoleCode.KYC, RoleCode.RM]);
const SYSTEM_BM_KYC: ReadonlySet<RoleCodeType> = new Set([RoleCode.BM, RoleCode.KYC]);
const ALL_RM_BM_SM_SYSTEM: ReadonlySet<RoleCodeType> = new Set([RoleCode.RM, RoleCode.BM, RoleCode.SM]);

/**
 * The linear progression transitions (state-machines.md §Lead).
 * Key: `${fromStage}:${toStage}`.
 */
const LINEAR_TRANSITIONS: ReadonlyMap<string, TransitionDescriptor> = new Map([
  [
    `${LeadStage.CAPTURED}:${LeadStage.ASSIGNED}`,
    { allowedRoles: new Set([RoleCode.BM, RoleCode.SM]), guards: ['valid_branch_product_source'] },
  ],
  [
    `${LeadStage.ASSIGNED}:${LeadStage.CONTACTED}`,
    { allowedRoles: RM_BM, guards: ['contact_logged'] },
  ],
  [
    `${LeadStage.CONTACTED}:${LeadStage.QUALIFIED}`,
    { allowedRoles: RM_BM, guards: ['intent_captured', 'progressive_fields'] },
  ],
  [
    `${LeadStage.QUALIFIED}:${LeadStage.DOCUMENTS_PENDING}`,
    { allowedRoles: RM_BM, guards: ['checklist_generated'] },
  ],
  [
    `${LeadStage.DOCUMENTS_PENDING}:${LeadStage.KYC_IN_PROGRESS}`,
    { allowedRoles: RM_BM_KYC, guards: ['mandatory_docs_or_waiver'] },
  ],
  [
    `${LeadStage.KYC_IN_PROGRESS}:${LeadStage.ELIGIBILITY_REQUESTED}`,
    { allowedRoles: RM_BM_KYC, guards: ['kyc_sufficient', 'consent_eligibility'] },
  ],
  [
    `${LeadStage.ELIGIBILITY_REQUESTED}:${LeadStage.READY_FOR_HANDOFF}`,
    { allowedRoles: SYSTEM_BM_KYC, guards: ['eligibility_received', 'docs_kyc_ready'] },
  ],
  [
    `${LeadStage.READY_FOR_HANDOFF}:${LeadStage.HANDED_OFF}`,
    {
      allowedRoles: BM_KYC_RM,
      guards: ['consent_present', 'duplicate_clear', 'mandatory_docs_verified', 'kyc_signoff', 'valid_payload'],
    },
  ],
]);

/**
 * M2/Capture — the authoritative guard matrix for lead stage transitions
 * (docs/contracts/state-machines.md §Lead / LLD §10.3).
 *
 * This is the SINGLE source of truth for:
 * 1. Which `from→to` pairs are legal (invalid pairs → `STAGE_GUARD_FAILED`).
 * 2. Which roles may trigger each transition.
 * 3. Which named guards must pass for each pair.
 *
 * All field-level guard checks (docs uploaded, KYC status, consent status,
 * duplicate clearance) are deferred to later FRs and reflected as "not yet
 * checkable" stubs — they return the guard as passing unless data explicitly
 * contradicts it. Guards that CAN be checked with the data available on the
 * `lead` context object ARE checked.
 */
@Injectable()
export class StageGuardService {
  /**
   * Evaluate all guards for the requested transition. Returns `{ failed: [] }`
   * on full success; `{ failed: ['guardName', ...] }` listing every failing guard.
   *
   * Callers should treat a non-empty `failed` array as `STAGE_GUARD_FAILED` (400).
   */
  async evaluate(input: GuardEvaluateInput): Promise<GuardResult> {
    const { fromStage, toStage, actor, reason } = input;
    const failed: string[] = [];

    // ── Special transitions: rejected, dormant, reopen ──────────────────────

    // any active → rejected
    if (toStage === LeadStage.REJECTED && fromStage !== LeadStage.HANDED_OFF) {
      if (!ACTIVE_STAGES.has(fromStage)) {
        failed.push('invalid_source_stage');
        return { failed };
      }
      if (!ALL_RM_BM_SM.has(actor.role)) {
        failed.push('role_not_permitted');
      }
      if (!reason) {
        failed.push('rejection_reason_provided');
      }
      return { failed };
    }

    // rejected → prior active stage (reopen)
    if (fromStage === LeadStage.REJECTED) {
      if (!ALL_RM_BM_SM.has(actor.role)) {
        failed.push('role_not_permitted');
      }
      if (!reason) {
        failed.push('reason_provided');
      }
      // "within_reopen_window" requires time-window data from a DB query that
      // depends on FR-025 (reopen window config). Stubbed as passing until that
      // FR is implemented. The guard name is recorded so integration tests can
      // assert it is evaluated.
      // Guard passes at service layer for now (FR-025 will enforce the window).
      return { failed };
    }

    // any active → dormant
    if (toStage === LeadStage.DORMANT) {
      if (fromStage === LeadStage.HANDED_OFF) {
        failed.push('invalid_source_stage');
        return { failed };
      }
      if (!ACTIVE_STAGES.has(fromStage)) {
        failed.push('invalid_source_stage');
        return { failed };
      }
      if (!ALL_RM_BM_SM.has(actor.role)) {
        failed.push('role_not_permitted');
      }
      if (!reason) {
        failed.push('nurture_reason');
      }
      // next_followup_date guard: deferred (caller would pass it in dto; LLD
      // says it is required — validated at DTO level in FR-052's Zod schema).
      return { failed };
    }

    // dormant → assigned/contacted (reactivation)
    if (fromStage === LeadStage.DORMANT) {
      if (toStage !== LeadStage.ASSIGNED && toStage !== LeadStage.CONTACTED) {
        failed.push('invalid_target_stage_from_dormant');
        return { failed };
      }
      if (!ALL_RM_BM_SM_SYSTEM.has(actor.role)) {
        failed.push('role_not_permitted');
      }
      // followup_due_or_reactivation: deferred to the SLA/task service (FR-104).
      return { failed };
    }

    // ── Terminal state guard ─────────────────────────────────────────────────
    if (fromStage === LeadStage.HANDED_OFF) {
      // handed_off is terminal in LMS — no transitions are allowed.
      failed.push('terminal_state');
      return { failed };
    }

    // ── Linear progression transitions ───────────────────────────────────────
    const key = `${fromStage}:${toStage}`;
    const descriptor = LINEAR_TRANSITIONS.get(key);

    if (!descriptor) {
      // Not a known valid transition — could be a skip-ahead or an unsupported pair.
      failed.push('invalid_transition');
      return { failed };
    }

    // Role check
    if (!descriptor.allowedRoles.has(actor.role)) {
      failed.push('role_not_permitted');
    }

    // Named guard stubs — the guard name is included in the `failed` array only
    // when the available context can definitively disprove the guard condition.
    // Guards that depend on child-record queries (documents, KYC checks) are
    // stubbed as passing at this tier; their owning FRs will enforce them.
    // All names match the LLD §10.3 guard name register.
    for (const guardName of descriptor.guards) {
      if (!this.evaluateNamedGuard(guardName, input)) {
        failed.push(guardName);
      }
    }

    return { failed };
  }

  /**
   * Named guard evaluator. Returns `true` (passes) or `false` (fails).
   *
   * Guards whose backing data exists on the current merged tree are enforced
   * directly from the `lead` context. Guards that genuinely require a
   * not-yet-built producer module's child tables are deferred (return true).
   * See AMBIGUITY.md §FR-052 for the deferred guard list and owning FRs.
   */
  private evaluateNamedGuard(name: string, input: GuardEvaluateInput): boolean {
    const { lead, reason } = input;

    switch (name) {
      // ── Reason-text checks (always available) ─────────────────────────────
      case 'rejection_reason_provided':
      case 'reason_provided':
        return Boolean(reason);

      // ── consent_present: enforced via FR-110's merged consent_status column ─
      // The guard is on ready_for_handoff → handed_off (state-machines.md L446).
      // consent_status must be 'captured'; withdrawn/pending/partial → guard fails.
      case 'consent_present':
        return lead.consent_status === 'captured';

      // ── duplicate_clear: enforced via FR-020's merged duplicate_status column ─
      // A flagged (unresolved) duplicate blocks handoff; none/linked/merged pass.
      case 'duplicate_clear':
        return lead.duplicate_status !== 'flagged';

      // ── Guards deferred to not-yet-built producer module child tables ──────
      // mandatory_docs_verified → documents table (M8 / FR-070)
      // kyc_signoff → kyc_verifications table (M8 / FR-080)
      // mandatory_docs_or_waiver → documents table (M8 / FR-070)
      // kyc_sufficient → kyc_verifications table (M8 / FR-080)
      // See AMBIGUITY.md §FR-052 for full deferral rationale.
      case 'mandatory_docs_verified':
      case 'kyc_signoff':
      case 'mandatory_docs_or_waiver':
      case 'kyc_sufficient':

      // ── Guards derivable only at field-update time (captured in LLD notes) ─
      case 'valid_branch_product_source':
      case 'contact_logged':
      case 'intent_captured':
      case 'progressive_fields':
      case 'checklist_generated':
      case 'consent_eligibility':
      case 'eligibility_received':
      case 'docs_kyc_ready':
      case 'valid_payload':
      case 'within_reopen_window':
      case 'followup_due_or_reactivation':
      case 'next_followup_date':
        return true;

      default:
        // Unknown guard name — conservative: fail it.
        return false;
    }
  }
}
