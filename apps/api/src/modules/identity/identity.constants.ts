import { RoleCode } from '@lms/shared';

/**
 * Reserved identifiers (docs/data-model/schema.sql header). The system actor is
 * used as `actor_id` for audit rows where no real user is established (e.g. a
 * failed login for a username that does not exist) and for system-initiated
 * status changes (lockout).
 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Roles for which MFA is mandatory regardless of the per-user `mfa_enabled`
 * flag (NFR-07 / LLD step 7). Other roles use MFA only when they have opted in.
 */
export const MFA_MANDATORY_ROLES: ReadonlySet<RoleCode> = new Set([
  RoleCode.ADMIN,
  RoleCode.DPO,
  RoleCode.HEAD,
  RoleCode.PARTNER,
]);

/** TOTP method label returned in the MFA-challenge response. */
export const MFA_METHOD_TOTP = 'totp';
