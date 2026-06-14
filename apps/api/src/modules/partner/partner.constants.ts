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
