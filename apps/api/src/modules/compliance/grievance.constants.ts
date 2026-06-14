/** ABAC resource type for the grievance endpoints (auth-matrix `resources`). */
export const GRIEVANCES_RESOURCE_TYPE = 'grievances';

/** Redis idempotency scope for POST /grievances (FR-114). */
export const IDEMPOTENCY_SCOPE_CREATE_GRIEVANCE = 'create_grievance';

/** 24 h TTL for cached idempotent responses (consistent with FR-010 pattern). */
export const IDEMPOTENCY_TTL_SECONDS = 86_400;

/** Largest sequence representable in the `GRV-{YYYY}-{seq6}` grievance-no format. */
export const GRIEVANCE_NO_MAX_SEQ = 999_999;

/** Hard LIMIT for grievance list queries (NFR-17). */
export const GRIEVANCE_LIST_MAX_LIMIT = 100;

/** System actor ID (same as capture module — no re-import to avoid circular dep). */
export const SYSTEM_ACTOR_ID_GRIEVANCE = '00000000-0000-0000-0000-000000000000';
