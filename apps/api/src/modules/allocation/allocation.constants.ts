import { LeadStage } from '@lms/shared';

/** ABAC resource type for the allocation-rule admin endpoints (auth-matrix `resources`). */
export const ALLOCATION_RULES_RESOURCE_TYPE = 'allocation_rules';

/** Active-rule scan bound (LLD §Data Operations step 1; NFR LIMIT ≤ 100). */
export const ACTIVE_RULES_LIMIT = 100;

/** Candidate-pool query bound (every list query LIMIT ≤ 100). */
export const CANDIDATE_POOL_LIMIT = 100;

/**
 * Stages that do NOT count toward an RM's active-lead load (FR-030 LLD step 5:
 * "stages not in handed_off, rejected, dormant").
 */
export const INACTIVE_LOAD_STAGES: readonly LeadStage[] = [
  LeadStage.HANDED_OFF,
  LeadStage.REJECTED,
  LeadStage.DORMANT,
];

/** Allocation-result reason when no rule matched (T07). */
export const NO_RULE_MATCH_REASON = 'no_rule_match';

/** `LEAD_ASSIGNED` payload reason on the unassigned-pool path (LLD step 7). */
export const UNASSIGNED_POOL_REASON = 'unassigned_pool';
