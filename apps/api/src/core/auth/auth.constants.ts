/**
 * Auth-flow constants shared by the guard, the token service, and the identity
 * module. Cookie attributes follow security.md (httpOnly, Secure, SameSite=Strict).
 */

/** httpOnly refresh-token cookie name (FR-001). */
export const REFRESH_COOKIE_NAME = 'lms_refresh';

/** Cookie Path — the refresh cookie is only sent to the auth routes. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Token-purpose discriminators carried in the JWT `type` claim. */
export const TokenType = {
  ACCESS: 'access',
  MFA_CHALLENGE: 'mfa_challenge',
  PW_RESET: 'pw_reset',
} as const;
export type TokenType = (typeof TokenType)[keyof typeof TokenType];

/** Short-lived TTLs (seconds) for the non-access tokens (LLD §Endpoints). */
export const MFA_CHALLENGE_TTL_SECONDS = 300; // 5 minutes
export const PW_RESET_TTL_SECONDS = 3 * 60 * 60; // 3 hours
