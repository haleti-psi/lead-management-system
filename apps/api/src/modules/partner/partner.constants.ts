import { PartnerStatus } from '@lms/shared';

/** ABAC resource type for the partner endpoints (auth-matrix `partners`). */
export const PARTNER_RESOURCE_TYPE = 'partners';

/** Roles allowed to suspend/expire a partner (LLD §Auth — ADMIN/HEAD only;
 * BM may edit metadata for in-scope partners but not change status). */
export const PARTNER_STATUS_ADMIN_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'HEAD']);

/** Valid `partner_status` transitions (LLD §State Machine). */
export const PARTNER_STATUS_TRANSITIONS: Readonly<Record<PartnerStatus, ReadonlySet<PartnerStatus>>> = {
  [PartnerStatus.ACTIVE]: new Set([PartnerStatus.SUSPENDED, PartnerStatus.EXPIRED]),
  [PartnerStatus.SUSPENDED]: new Set([PartnerStatus.ACTIVE, PartnerStatus.EXPIRED]),
  [PartnerStatus.EXPIRED]: new Set<PartnerStatus>(),
};

/** Status values that require a `statusReason` (LLD §Validation). */
export const STATUS_REASON_REQUIRED: ReadonlySet<string> = new Set([
  PartnerStatus.SUSPENDED,
  PartnerStatus.EXPIRED,
]);

/** Allow-listed sort fields → `partners` columns (LLD §GET). */
export const PARTNER_SORT_COLUMNS = ['legal_name', 'created_at', 'valid_until', 'quality_score'] as const;
export type PartnerSortField = (typeof PARTNER_SORT_COLUMNS)[number];

// ─────────────────────────────────────── FR-092 partner quality score (§12.4) ──

/** Minimum submitted leads for a valid score (LLD Assumption 5; env not added → const). */
export const PARTNER_QUALITY_MIN_VOLUME = 10;

/** §12.4 factor weights (hard-coded — no config table; LLD Assumption 6). */
export const QUALITY_FACTOR_WEIGHTS = {
  contactability_index: 0.25,
  handoff_index: 0.3,
  document_quality_index: 0.2,
  speed_index: 0.15,
  duplicate_penalty: -0.05,
  rejection_penalty: -0.05,
} as const;

/** Stages counted as "contactable" — reached `contacted` or later (LLD §B / Assumption 1). */
export const CONTACTABLE_STAGES = [
  'contacted',
  'qualified',
  'documents_pending',
  'kyc_in_progress',
  'eligibility_requested',
  'ready_for_handoff',
  'handed_off',
] as const;

/** duplicate_status values counted as duplicates (LLD §B). */
export const DUPLICATE_STATUSES = ['flagged', 'linked', 'merged'] as const;
