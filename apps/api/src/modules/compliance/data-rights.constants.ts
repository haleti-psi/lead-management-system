/** ABAC resource type for the data-rights endpoints (auth-matrix `resources`). */
export const DATA_RIGHTS_RESOURCE_TYPE = 'data_rights_requests';

/** Redis idempotency scope for POST /data-rights (FR-112). */
export const IDEMPOTENCY_SCOPE_CREATE_DATA_RIGHTS = 'create_data_rights';

/** 24 h TTL for cached idempotent responses (LLD §Create flow step 8). */
export const DATA_RIGHTS_IDEMPOTENCY_TTL_SECONDS = 86_400;

/** Hard LIMIT for data-rights list queries (NFR-17 / performance.md). */
export const DATA_RIGHTS_LIST_MAX_LIMIT = 100;

/**
 * Fallback SLA due days when no sla_policies entry exists for data-rights
 * (LLD §Ambiguity #1: sla_target enum has no 'data_rights' value; we use
 * 'grievance' policy if available, else fall back to 30 calendar days).
 */
export const DATA_RIGHTS_SLA_FALLBACK_DAYS = 30;
