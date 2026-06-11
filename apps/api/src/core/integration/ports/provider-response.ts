/**
 * The shape every provider adapter returns to the {@link IntegrationGateway}
 * (FR-140 LLD §Backend Flow step 5). It is transport-shaped, not domain-shaped:
 * the gateway only needs the HTTP status (to classify success vs. retryable
 * failure) and an opaque body it caches verbatim for idempotent replay. Domain
 * decoding is the calling module's job, done on the returned `body`.
 *
 * Adapters NEVER throw for a provider-level error (4xx/5xx); they return it as a
 * `ProviderResponse` with the status set, so the gateway makes the single,
 * central retry/circuit-breaker/dead-letter decision. They throw only for a
 * transport fault (network error / timeout), which {@link ProviderCallError}
 * models.
 */
export interface ProviderResponse<TBody = unknown> {
  /** HTTP status returned by the provider (200..599). */
  httpStatus: number;
  /** Parsed/opaque response body — cached as-is for idempotent replay. */
  body: TBody;
}

/** True for a 2xx provider status (the gateway's success predicate). */
export function isSuccessStatus(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus < 300;
}

/**
 * A transport-level failure (DNS/connect/reset/timeout) raised by an adapter's
 * `fetch`. Carries no provider HTTP status (there was no response). The gateway
 * treats this exactly like a 5xx for retry/circuit-breaker purposes but records
 * `http_status = null`.
 */
export class ProviderCallError extends Error {
  /** Machine code recorded in `integration_logs.error_code` (≤60 chars). */
  readonly errorCode: string;

  constructor(errorCode: string, message?: string, options?: { cause?: unknown }) {
    super(message ?? errorCode, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderCallError';
    this.errorCode = errorCode;
  }
}
