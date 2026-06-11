// Permitted error codes ONLY — BRD §8.4 / docs/contracts/error-taxonomy.md.
// HTTP status mapping is enforced server-side; never introduce a code not listed here.
// Domain sub-reasons (DUPLICATE_BLOCKED, STAGE_GUARD_FAILED, CONSENT_MISSING,
// IDEMPOTENT_REPLAY, EXPORT_APPROVAL_REQUIRED, LEGAL_HOLD) ride in error.detail.reason.
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',         // 400
  AUTH_REQUIRED: 'AUTH_REQUIRED',               // 401
  FORBIDDEN: 'FORBIDDEN',                        // 403
  NOT_FOUND: 'NOT_FOUND',                        // 404
  CONFLICT: 'CONFLICT',                          // 409
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',        // 413
  UNSUPPORTED_MEDIA: 'UNSUPPORTED_MEDIA',        // 415
  RATE_LIMITED: 'RATE_LIMITED',                  // 429
  INTERNAL_ERROR: 'INTERNAL_ERROR',             // 500
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',  // 503
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
