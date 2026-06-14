import type { RoleCode } from '@lms/shared';

/**
 * FR-053 — resolved dashboard scope context derived from the authenticated user
 * plus any query overrides (`branch_id`, `team_id`). All widget queries consume
 * this shape; scope is enforced IN SQL (applyScopeFilter) — never post-filtered.
 */
export interface DashboardScopeContext {
  readonly role: RoleCode;
  readonly userId: string;
  readonly orgId: string;
  /** For BM / KYC scope: the effective branch id(s). */
  readonly branchIds: readonly string[];
  /** For SM scope: the effective team member user id(s). */
  readonly teamMemberIds: readonly string[];
  /** ISO 8601 — "as at" timestamp; defaults to now() (DB side). */
  readonly asOf: Date;
}
