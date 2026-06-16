import type { AuditAction } from '@lms/shared';

/**
 * FR-123 — Audit Explorer types (M13). Mirrors the backend response shapes of
 * `GET /api/v1/audit` and `POST /api/v1/audit/unmask`
 * (apps/api/src/modules/reporting/audit-explorer.*). The web never receives raw
 * PII in the list: `detail` arrives already masked by the server; the only raw
 * reveal is the explicit, separately-audited single-field unmask.
 */

/** Per-page hash-chain integrity verdict (LLD §Hash-chain integrity). */
export type IntegrityBadge = 'intact' | 'broken' | 'not_checked';

/**
 * A single audit row as serialised by the explorer (no `ip_device` — forensic
 * only, never exposed). `detail` PII keys are server-masked; ADMIN rows always
 * carry `lead_id: null`.
 */
export interface AuditItem {
  audit_id: string;
  actor_id: string;
  /** "<full name> · <role code>" — never includes mobile/email/PAN. */
  actor_display: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  before_hash: string | null;
  after_hash: string | null;
  prev_audit_hash: string | null;
  /** Masked `detail` JSONB (PII keys already masked/redacted by the server). */
  detail: Record<string, unknown> | null;
  created_at: string;
}

/** The `data` body of `GET /audit`: the page of items + the integrity badge. */
export interface AuditPageData {
  items: AuditItem[];
  integrity_badge: IntegrityBadge;
}

/**
 * The explorer query filters surfaced in the UI. Pagination (`page`/`limit`) is
 * tracked by the page component separately. `lead_id` is DPO-only (ADMIN gets a
 * 403 if it is sent), so it is not part of the shared filter bar state.
 */
export interface AuditFilters {
  action?: AuditAction;
  entity_type?: string;
  actor_id?: string;
  /** ISO-8601 date (yyyy-mm-dd) lower bound, inclusive. */
  from?: string;
  /** ISO-8601 date (yyyy-mm-dd) upper bound, inclusive. */
  to?: string;
}

/**
 * The integrity diagnostics carried on the response `meta` (alongside the
 * standard pagination block). Surfaced by the per-page integrity badge.
 */
export interface AuditIntegrityMeta {
  badge: IntegrityBadge;
  /** How many rows in the current window were chain-checked. */
  checkedCount: number;
  /** The `audit_id` of the first broken link, or null when intact/not_checked. */
  breakAt: string | null;
}

/** The full result the `useAudit` hook returns: items, integrity, and total. */
export interface AuditPageResult {
  items: AuditItem[];
  integrity: AuditIntegrityMeta;
  total: number;
}

/**
 * The PII `detail` keys that the server permits to be individually unmasked
 * (mirrors `AUDIT_DETAIL_PII_FIELDS` + `AUDIT_DETAIL_REDACT_FIELDS` in
 * apps/api/src/modules/reporting/reporting.constants.ts). Used to render the
 * Unmask affordance only on these keys.
 */
export const UNMASKABLE_DETAIL_FIELDS = [
  'name',
  'mobile',
  'email',
  'pan_token',
  'aadhaar_ref_token',
  'ckyc_id',
] as const;

export type UnmaskableDetailField = (typeof UNMASKABLE_DETAIL_FIELDS)[number];

/** Body of `POST /audit/unmask`: one field, one row, with a mandatory reason. */
export interface AuditUnmaskRequest {
  audit_id: string;
  field: UnmaskableDetailField;
  /** Justification (server requires 10–500 chars); recorded in the audit trail. */
  reason: string;
}

/** Result of a privileged single-field unmask: the one revealed raw value. */
export interface AuditUnmaskResult {
  audit_id: string;
  field: string;
  /** The revealed raw value, or null when the field was absent/empty. */
  value: string | null;
}
