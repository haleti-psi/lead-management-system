import { ERROR_CODES, type ApiError, type ApiFieldError, type ErrorCode } from '@lms/shared';

/**
 * The single error type every apiClient call rejects with. It carries the
 * server's uniform `error` object (BRD §4.4 / error-taxonomy.md §8.4) verbatim —
 * the taxonomy `code`, the human `message`, `retryable`, and the optional
 * `fields`/`detail` — plus the transport `status` and the `correlation_id` from
 * `meta` (for support/log correlation). UI layers branch on `code`, render
 * field-level issues from `fields`, and surface `message` to the user; they never
 * parse free-form strings.
 */
export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly fields?: ApiFieldError[];
  readonly detail?: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(args: {
    code: ErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    fields?: ApiFieldError[];
    detail?: Record<string, unknown>;
    correlationId?: string;
  }) {
    super(args.message);
    this.name = 'ApiClientError';
    this.code = args.code;
    this.status = args.status;
    this.retryable = args.retryable;
    this.fields = args.fields;
    this.detail = args.detail;
    this.correlationId = args.correlationId;
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

/** HTTP status → taxonomy code, for responses that arrive without an envelope
 * (proxy/gateway errors, network failures). Enveloped errors use `error.code`. */
const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.AUTH_REQUIRED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.PAYLOAD_TOO_LARGE,
  415: ERROR_CODES.UNSUPPORTED_MEDIA,
  429: ERROR_CODES.RATE_LIMITED,
  503: ERROR_CODES.UPSTREAM_UNAVAILABLE,
};

/** Build an `ApiClientError` from the server's `error` envelope object. */
export function fromApiError(
  error: ApiError,
  status: number,
  correlationId?: string,
): ApiClientError {
  return new ApiClientError({
    code: error.code,
    message: error.message,
    status,
    retryable: error.retryable,
    fields: error.fields,
    detail: error.detail,
    correlationId,
  });
}

/** Build an `ApiClientError` for a response with no parseable envelope. */
export function fromStatus(status: number, message?: string): ApiClientError {
  const code = STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;
  return new ApiClientError({
    code,
    message: message ?? `Request failed (${status})`,
    status,
    retryable: status >= 500 || status === 429,
  });
}

/** Build an `ApiClientError` for a transport failure (fetch rejected — server
 * unreachable, DNS, CORS, aborted). Treated as a retryable upstream outage. */
export function fromNetwork(cause: unknown): ApiClientError {
  return new ApiClientError({
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: 'Unable to reach the server. Please check your connection and try again.',
    status: 0,
    retryable: true,
    detail: cause instanceof Error ? { reason: cause.name } : undefined,
  });
}
