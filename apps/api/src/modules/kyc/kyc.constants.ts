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

// ───────────────────────────────────────── FR-072 KYC exception resolution ──

/** Roles permitted to resolve KYC exceptions (FR-072 §Auth — KYC/BM only; DPO
 * holds `kyc_signoff` scope M but exception resolution is restricted to KYC/BM). */
export const KYC_SIGNOFF_ROLES: ReadonlySet<string> = new Set(['KYC', 'BM']);

/**
 * Allowed `resolution_code` values (FR-072 §Validation — A-3 best-effort; the
 * column is VARCHAR(40), not an enum). Confirm with compliance/product.
 */
export const ALLOWED_RESOLUTION_CODES = [
  're_verified',
  'document_replaced',
  'name_variance_waiver',
  'address_variance_waiver',
  'waiver',
  'provider_down_manual',
  'ckyc_manual_capture',
  'duplicate_ckyc_resolved',
  'vcip_retaken',
] as const;
export type ResolutionCode = (typeof ALLOWED_RESOLUTION_CODES)[number];

/**
 * Resolution codes that WAIVE the check (→ `kyc_check_status='waived'`); all
 * others mark the check satisfied (→ `success`). There is no `resolved` enum
 * value (AMBIGUITY FR-072-A5).
 */
export const WAIVER_RESOLUTION_CODES: ReadonlySet<string> = new Set([
  'waiver',
  'name_variance_waiver',
  'address_variance_waiver',
]);

/** Resolution codes that require an `evidenceRef` (FR-072 §Validation). */
export const EVIDENCE_REQUIRED_CODES: ReadonlySet<string> = new Set(['waiver', 'provider_down_manual']);

/** Compliance flag key in `product_configs.sla_config` JSONB gating
 * `provider_down_manual` (AMBIGUITY FR-072-A1 — best-effort location). */
export const MANUAL_FALLBACK_FLAG = 'kyc_manual_fallback_enabled';
