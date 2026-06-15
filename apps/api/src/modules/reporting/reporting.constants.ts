import { AuditAction, RoleCode } from '@lms/shared';

import type { MaskableField } from '../../core/masking';

/**
 * FR-120 — the canonical list of report codes for the core report pack.
 * FR-121 will extend this list when differentiator codes are added.
 * The `code` path param is validated against this list → VALIDATION_ERROR on
 * an unknown code (LLD §Error Cases).
 */
export const REPORT_CODES = [
  'funnel_conversion',
  'source_performance',
  'rm_performance',
  'rejection_summary',
] as const;

export type ReportCode = typeof REPORT_CODES[number];

/**
 * FR-123 constants for the audit explorer (M13). Centralised so the DTO,
 * service, and repository share one source of truth and never drift.
 */

/**
 * Roles permitted to use the `/audit` explorer endpoint. The `audit_trail`
 * capability exists at narrower scopes for other roles (RM/BM/SM/HEAD/KYC/…) in
 * auth-matrix.json, but the explorer surface itself is restricted to the
 * compliance roles. Enforced at the service layer (the ABAC capability check
 * alone would admit a scope-O RM).
 */
export const AUDIT_EXPLORER_ROLES: ReadonlySet<RoleCode> = new Set<RoleCode>([
  RoleCode.DPO,
  RoleCode.ADMIN,
]);

/**
 * ADMIN sees ONLY system/config-scoped actions (auth-matrix `ADMIN.*` withholds
 * lead content). Applied as a mandatory server-side `action IN (...)` filter that
 * user input can never widen, plus `lead_id` is zeroed in every ADMIN response.
 */
export const ADMIN_ALLOWED_ACTIONS: readonly AuditAction[] = [
  AuditAction.CONFIG_CHANGE,
  AuditAction.USER_CHANGE,
  AuditAction.ROLE_CHANGE,
  AuditAction.BREAK_GLASS_ACCESS,
  AuditAction.LOGIN,
  AuditAction.LOGOUT,
  AuditAction.LOGIN_FAILED,
  AuditAction.MFA_FAILED,
  AuditAction.EXPORT_GENERATE,
  AuditAction.EXPORT_DOWNLOAD,
] as const;

/**
 * Canonical entity types accepted by the `entity_type` filter. A closed
 * allow-list prevents probing for non-canonical table names / schema discovery
 * (anything outside the list → VALIDATION_ERROR).
 */
export const ENTITY_TYPE_ALLOWLIST: readonly string[] = [
  'leads',
  'users',
  'roles',
  'consent_records',
  'stage_history',
  'documents',
  'kyc_verifications',
  'export_jobs',
  'configuration_versions',
  'break_glass_grants',
  'partners',
  'tasks',
  'grievances',
  'data_rights_requests',
  'import_jobs',
  'communication_logs',
  'dla_registry',
] as const;

/**
 * PII keys inside the `detail` JSONB and the masker field-kind that knows their
 * format. `ckyc_id` has no format-preserving mask and is wholly redacted (mirrors
 * MaskingService.maskEventPayload's redact set). Everything else in `detail`
 * passes through untouched.
 */
export const AUDIT_DETAIL_PII_FIELDS: Readonly<Record<string, MaskableField>> = {
  name: 'full_name',
  mobile: 'mobile',
  email: 'email',
  pan_token: 'pan',
  aadhaar_ref_token: 'aadhaar',
};

/** `detail` keys that carry no partial mask — fully redacted unless break-glass. */
export const AUDIT_DETAIL_REDACT_FIELDS: ReadonlySet<string> = new Set(['ckyc_id']);

/** Read-tier rate limit for the explorer (requests/min per user) — NFR. */
export const AUDIT_READ_RATE_LIMIT = 300;
