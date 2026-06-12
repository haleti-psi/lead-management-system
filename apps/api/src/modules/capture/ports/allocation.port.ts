import type { AllocationMethod, LeadStage } from '@lms/shared';

import type { DbTransaction } from '../../../core/db';

/**
 * FR-010 → FR-030 dependency seam (Wave-2 cross-FR port, per the Wave-1
 * convention: consumer defines a NARROW port; the owner FR binds the adapter).
 * Automatic allocation runs SYNCHRONOUSLY inside the creating UnitOfWork
 * transaction (FR-030 LLD §Backend Flow Path A step 1) — the lead INSERT and
 * its allocation commit (or roll back) together. `AllocationService` (M4,
 * FR-030) binds {@link ALLOCATION_PORT} from its @Global module.
 */

/** Trigger context — `actorId` is the system actor for post-create allocation. */
export interface AllocationTriggerInput {
  leadId: string;
  orgId: string;
  actorId: string;
  /** `leads.version` the caller just wrote (1 for a fresh capture). */
  expectedVersion: number;
}

/** Outcome of one allocation pass (FR-030 LLD §Data Operations / T07). */
export interface AllocationOutcome {
  /** Winning RM, or null when no rule matched (branch unassigned pool). */
  ownerId: string | null;
  teamId: string | null;
  /** Lead stage after the pass (`assigned`, or unchanged on no-match). */
  stage: LeadStage;
  /** `leads.version` after the pass. */
  version: number;
  /** `rule:{name}` on a match; `no_rule_match` on the unassigned-pool path. */
  reason: string;
  method: AllocationMethod | null;
  allocationRuleId: string | null;
}

export interface AllocationPort {
  /**
   * Evaluate active `allocation_rules` (priority_order ASC, first match wins)
   * with capacity checks and assign owner + team via `LeadService.assignOwner`
   * — all inside the caller's transaction. No-match routes the lead to the
   * branch unassigned pool (owner stays null) and emits the alert.
   */
  allocate(input: AllocationTriggerInput, tx: DbTransaction): Promise<AllocationOutcome>;
}

/** DI token for {@link AllocationPort} (bound by `allocation.module.ts`, FR-030). */
export const ALLOCATION_PORT = Symbol('ALLOCATION_PORT');
