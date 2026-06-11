import type { Capability, DataScope, RoleCode, UserStatus } from '@lms/shared';

/**
 * Internal ABAC types for FR-002. The public/wire shapes (EntitlementResult,
 * ScopePredicate, AbacResource) live in `@lms/shared`; these are the server-side
 * actor-context shapes assembled from the DB (FR-002 §Data Operations) and
 * consumed by {@link EntitlementService}.
 */

/** One row of a role's capability grant (`role_permissions`). */
export interface RolePermissionEntry {
  readonly capability: Capability;
  readonly maxScope: DataScope;
  /** `role_permissions.conditions` JSONB — opaque per-capability flags (rarely used). */
  readonly conditions: Record<string, unknown> | null;
}

/**
 * An active break-glass grant for an ADMIN/DPO actor (FR-003 owns the grant
 * lifecycle; FR-002 only reads an already-active grant). `scopeType` is the DB
 * `break_glass_grants.scope_type` (`'lead' | 'branch' | 'all'`).
 */
export interface ActiveBreakGlassGrant {
  readonly grantId: string;
  readonly scopeType: 'lead' | 'branch' | 'all';
  /** `break_glass_grants.scope_ref` — the lead/branch the grant is bound to (null for 'all'). */
  readonly scopeRef: string | null;
  readonly validUntil: Date;
}

/**
 * The full actor entitlement record loaded once per decision (cached in Redis):
 * the user's scope attributes plus their role's capability map. Built by
 * {@link EntitlementCacheService.loadActorEntitlement} (FR-002 Read 1).
 */
export interface ActorEntitlement {
  readonly userId: string;
  readonly orgId: string;
  readonly status: UserStatus;
  readonly roleId: string;
  readonly roleCode: RoleCode;
  readonly defaultScope: DataScope;
  readonly branchId: string | null;
  readonly teamId: string | null;
  readonly regionId: string | null;
  readonly partnerId: string | null;
  /** capability → grant, for O(1) lookup during evaluation. */
  readonly permissions: ReadonlyMap<Capability, RolePermissionEntry>;
}
