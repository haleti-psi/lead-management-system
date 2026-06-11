// ABAC (FR-002) shared contract types — the wire/decision shapes used by both
// apps/api (EntitlementService, AbacGuard, repositories) and, for the masking
// hint, apps/web. Authoritative behaviour lives in docs/lld/FR-002.md and
// docs/contracts/auth-matrix.json. These are pure data types — no runtime logic.
import type { DataClassification, DataScope } from '../enums';

/**
 * The resource an actor is attempting to act on. Built by a `@Requires`
 * scopeResolver from the request (path params / pre-loaded entity) and passed to
 * `EntitlementService.can()`. All attributes are optional because not every
 * capability is resource-scoped (e.g. a list/create with no pre-known owner);
 * the evaluator uses whichever attributes the effective scope requires.
 */
export interface AbacResource {
  /** A resource type from auth-matrix.json `resources` (e.g. `'leads'`). */
  readonly resourceType: string;
  /** `leads.owner_id` — used by scope O (own) and T (team) ownership checks. */
  readonly ownerId?: string | null;
  /** `leads.branch_id` — used by scope B (branch) and R (region) checks. */
  readonly branchId?: string | null;
  /** `leads.partner_id`/`source_attributions.partner_id` — scope P checks. */
  readonly partnerId?: string | null;
  /** Optional sensitivity tag; reserved for classification-aware policies. */
  readonly dataClassification?: DataClassification;
}

/**
 * Why an entitlement check denied. Surfaced to the client only as the allowed
 * `error.detail.reason` values (error-taxonomy.md) — never a free-form rule
 * description. `PARTNER_CROSS_ACCESS` maps to 404 (existence hidden); the rest
 * map to 403 FORBIDDEN.
 */
export type EntitlementDenyReason =
  | 'NO_CAPABILITY'
  | 'OUT_OF_SCOPE'
  | 'SUSPENDED_USER'
  | 'ADMIN_LEAD_BLOCKED'
  | 'PARTNER_CROSS_ACCESS';

/**
 * A serialisable filter descriptor the downstream repository applies to every
 * scoped Kysely query (FR-002 §Data Operations). The owning module translates it
 * to a `where(...)`; it never reaches the client.
 */
export type ScopePredicate =
  | { readonly type: 'own'; readonly userId: string }
  | { readonly type: 'team'; readonly userIds: readonly string[] }
  | { readonly type: 'branch'; readonly branchId: string }
  | { readonly type: 'region'; readonly branchIds: readonly string[] }
  | { readonly type: 'all'; readonly orgId: string }
  | { readonly type: 'partner'; readonly partnerId: string }
  | { readonly type: 'masked'; readonly orgId: string }
  | { readonly type: 'customer_token'; readonly leadId: string };

/**
 * The outcome of `EntitlementService.can()`. Deny-by-default: any path that does
 * not explicitly grant returns `{ granted: false }` with a reason. On grant, the
 * resolved `scope` and `scopePredicate` are attached to the request for the
 * handler/repository and the masking interceptor to consume.
 */
export type EntitlementResult =
  | { readonly granted: true; readonly scope: DataScope; readonly scopePredicate: ScopePredicate }
  | { readonly granted: false; readonly reason: EntitlementDenyReason };
