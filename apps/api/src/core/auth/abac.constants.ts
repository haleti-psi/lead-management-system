import { Capability, DataScope } from '@lms/shared';

/**
 * ABAC (FR-002) constants: Redis cache keys/TTLs (FR-002 §Data Operations) and
 * the scope-ordering / capability classifications the evaluation algorithm uses.
 * TTL seconds are the LLD's stated values; they are deliberately short so a
 * role/permission change becomes visible quickly even absent an explicit
 * invalidation (the explicit hook is {@link EntitlementCacheService.invalidateRole}).
 */

/** `abac:{orgId}:{userId}` → cached {@link ActorEntitlement}. */
export const actorCacheKey = (orgId: string, userId: string): string => `abac:${orgId}:${userId}`;
export const ACTOR_CACHE_TTL_SECONDS = 60;

/** `team_members:{teamId}` → active member user_ids (scope T). */
export const teamMembersCacheKey = (teamId: string): string => `team_members:${teamId}`;
export const TEAM_MEMBERS_CACHE_TTL_SECONDS = 120;

/** `region_branches:{regionId}` → active branch_ids (scope R). */
export const regionBranchesCacheKey = (regionId: string): string => `region_branches:${regionId}`;
export const REGION_BRANCHES_CACHE_TTL_SECONDS = 300;

/** Safety ceiling on a role's capability rows (a role has ≤ 18; FR-002 Read 1). */
export const ROLE_PERMISSIONS_LIMIT = 50;
/** Safety ceiling on team-member / region-branch list reads (FR-002 Read 2/3). */
export const SCOPE_LIST_LIMIT = 100;

/**
 * Scope permissiveness, most → least (FR-002 evaluation algorithm step 3:
 * `effective = min(role.max_scope, attribute scope)`). A *lower* rank is *more*
 * permissive, so "min" (narrower) = the larger rank value.
 */
export const SCOPE_ORDER: readonly DataScope[] = [
  DataScope.A,
  DataScope.R,
  DataScope.B,
  DataScope.T,
  DataScope.O,
  DataScope.P,
  DataScope.C,
  DataScope.M,
  DataScope.X,
];

const SCOPE_RANK: ReadonlyMap<DataScope, number> = new Map(
  SCOPE_ORDER.map((scope, index) => [scope, index]),
);

/** Rank of a scope (0 = most permissive). Unknown scopes sort to least-permissive. */
export function scopeRank(scope: DataScope): number {
  return SCOPE_RANK.get(scope) ?? SCOPE_ORDER.length;
}

/** The narrower (less permissive) of two scopes — the effective-scope `min`. */
export function narrowerScope(a: DataScope, b: DataScope): DataScope {
  return scopeRank(a) >= scopeRank(b) ? a : b;
}

/**
 * Capabilities that expose a specific lead's record/PII (the "lead content" the
 * auth-matrix `ADMIN.*` note withholds from ADMIN absent a break-glass grant, and
 * the set the DPO masked-compliance view (M) applies to). This is deliberately
 * the lead-*record* surface only — it EXCLUDES the administrative/compliance
 * capabilities that ADMIN/DPO legitimately hold org-wide (`export`,
 * `consent_ledger`, `audit_trail`, `customer_comm`, `reports`, `configuration`,
 * `user_mgmt`, `break_glass`), so those proceed through the normal capability
 * lookup rather than being force-blocked.
 */
export const LEAD_CONTENT_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  Capability.CREATE_LEAD,
  Capability.VIEW_LEAD,
  Capability.EDIT_LEAD,
  Capability.UPLOAD_DOC,
  Capability.VERIFY_DOC,
  Capability.KYC_SIGNOFF,
  Capability.MOVE_STAGE,
  Capability.HAND_OFF,
  Capability.ALLOCATE,
  Capability.BULK_ACTION,
]);
