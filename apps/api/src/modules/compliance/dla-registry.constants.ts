/** ABAC resource type for the DLA registry endpoints (auth-matrix `resources`). */
export const DLA_REGISTRY_RESOURCE_TYPE = 'dla_registry';

/** Hard LIMIT for DLA registry list queries (NFR-17). */
export const DLA_REGISTRY_LIST_MAX_LIMIT = 100;

/**
 * Allowed sort values for GET /compliance/dla.
 * Bare values (e.g. `name`) → ascending; `-`-prefixed (e.g. `-name`) → descending.
 * Both forms are needed so callers can request either direction explicitly.
 */
export const DLA_REGISTRY_ALLOWED_SORT_COLUMNS = [
  'name', '-name',
  'type', '-type',
  'status', '-status',
  'created_at', '-created_at',
] as const;

/** Default sort value (descending by created_at, expressed as `-created_at`). */
export const DLA_REGISTRY_DEFAULT_SORT = '-created_at';
export const DLA_REGISTRY_DEFAULT_SORT_DIR = 'desc' as const;
