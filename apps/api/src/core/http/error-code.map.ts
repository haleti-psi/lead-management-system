import { ERROR_CODES, type ErrorCode } from '@lms/shared';

/**
 * Canonical HTTP-status ↔ error-code mapping (docs/contracts/error-taxonomy.md /
 * BRD §8.4). This catalog is authoritative: VALIDATION_ERROR = 400 (not 422),
 * 403 = FORBIDDEN, upstream failures = UPSTREAM_UNAVAILABLE (503). Only these
 * codes may ever leave the API.
 */
export const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.AUTH_REQUIRED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.PAYLOAD_TOO_LARGE,
  415: ERROR_CODES.UNSUPPORTED_MEDIA,
  429: ERROR_CODES.RATE_LIMITED,
  500: ERROR_CODES.INTERNAL_ERROR,
  503: ERROR_CODES.UPSTREAM_UNAVAILABLE,
};

/** HTTP status for each error code (inverse of {@link STATUS_TO_CODE}). */
export const CODE_TO_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_UNAVAILABLE: 503,
};

/** Per the taxonomy, only transient upstream failures are client-retryable. */
export function isRetryable(code: ErrorCode): boolean {
  return code === ERROR_CODES.UPSTREAM_UNAVAILABLE;
}

/** Maps an arbitrary HTTP status to a taxonomy code; anything unmapped → INTERNAL_ERROR. */
export function codeForStatus(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;
}

/** Generic, non-leaking default message per code (overridable by the thrower). */
export const DEFAULT_MESSAGE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Please correct the highlighted fields.',
  AUTH_REQUIRED: 'Please sign in to continue.',
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "We couldn't find that item.",
  CONFLICT: 'This action conflicts with the current state. Refresh and retry.',
  PAYLOAD_TOO_LARGE: 'File is too large.',
  UNSUPPORTED_MEDIA: 'Unsupported file type.',
  RATE_LIMITED: 'Too many attempts. Please wait and try again.',
  INTERNAL_ERROR: "Something went wrong. We're on it.",
  UPSTREAM_UNAVAILABLE: "A service is temporarily unavailable. We'll retry.",
};
