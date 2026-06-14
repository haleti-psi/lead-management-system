/** ABAC resource type for the document endpoints (auth-matrix `resources.documents`). */
export const DOCUMENTS_RESOURCE_TYPE = 'documents';

/** Allowed upload MIME types (LLD §Validation — file_type). */
export const ALLOWED_FILE_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
]);

/**
 * Roles permitted to waive a document (LLD §Auth — additional role check;
 * `verify_doc` is held only by KYC and BM per auth-matrix). RM/SM/PARTNER hold
 * no `verify_doc`, so they are rejected with FORBIDDEN.
 */
export const WAIVER_ROLE_CODES: ReadonlySet<string> = new Set(['KYC', 'BM']);

/** Hard LIMIT for the per-lead document list read (NFR-17; ≤ 100). */
export const DOCUMENTS_LIST_LIMIT = 100;

/** GCS object-key prefix for lead documents. */
export const DOCUMENT_STORAGE_PREFIX = 'leads';
