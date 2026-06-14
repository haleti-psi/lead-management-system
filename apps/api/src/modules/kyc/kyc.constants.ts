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

// ───────────────────────────────────────────── FR-071 KYC orchestration ──

/** ABAC resource type for the KYC verification endpoint (auth-matrix `resources`). */
export const KYC_RESOURCE_TYPE = 'kyc_verifications';

/**
 * Roles permitted to run KYC orchestration (LLD §Auth — KYC/BM only). RM holds
 * `verify_doc` scope O for preliminary document checks but is excluded from KYC
 * provider orchestration at the capability-condition level.
 */
export const KYC_ORCHESTRATOR_ROLES: ReadonlySet<string> = new Set(['KYC', 'BM']);

/** Hard LIMIT for the per-lead kyc_verifications read used to derive kyc_status
 * (LLD §computeLeadKycStatus / Assumption 4; ≤ 100, bounded by 6 check types). */
export const KYC_VERIFICATIONS_LIMIT = 100;
