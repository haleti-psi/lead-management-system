import { DataScope } from '@lms/shared';

/** ABAC resource type for the saved-view endpoints (auth-matrix `resources`). */
export const SAVED_VIEWS_RESOURCE_TYPE = 'saved_views';

/**
 * `score_band` thresholds (FR-050 LLD §Data Operations — `leads.score` 0..100):
 * `hot ≥ 75`, `warm 50–74`, `cold < 50`, `unscored = score IS NULL`.
 */
export const SCORE_BAND_HOT_MIN = 75;
export const SCORE_BAND_WARM_MIN = 50;

/**
 * Relative width of each data scope, used for the saved-view share check
 * (FR-050 LLD §Validation — `is_shared=true` requires `scope ⊆` the caller's
 * own `view_lead` scope). `M` (DPO masked compliance view) spans the org, so it
 * shares the `A` width; `P`/`C` are single-principal scopes; `X` grants nothing.
 */
export const SCOPE_WIDTH: Readonly<Record<DataScope, number>> = {
  [DataScope.X]: 0,
  [DataScope.O]: 1,
  [DataScope.P]: 1,
  [DataScope.C]: 1,
  [DataScope.T]: 2,
  [DataScope.B]: 3,
  [DataScope.R]: 4,
  [DataScope.M]: 5,
  [DataScope.A]: 5,
};

/**
 * Scope-predicate types FR-050 serves on `/leads` (internal staff scopes only).
 * PARTNER (`partner`) and CUSTOMER (`customer_token`) callers are not FR-050
 * roles — they use `/partners/leads` (FR-091) / `/c/{token}` (FR-060) — so the
 * workspace list denies them with `403 FORBIDDEN` (LLD §Auth Check).
 */
export const INTERNAL_LIST_PREDICATE_TYPES: ReadonlySet<string> = new Set([
  'own',
  'team',
  'branch',
  'region',
  'all',
  'masked',
]);

/**
 * Scope-predicate types eligible to dispatch a bulk action (auth-matrix
 * `bulk_action`: SM=T, BM=B, KYC=B, HEAD=A — never O/P/C/M). Writes are never
 * dispatched under the DPO masked view.
 */
export const BULK_PREDICATE_TYPES: ReadonlySet<string> = new Set([
  'team',
  'branch',
  'region',
  'all',
]);
