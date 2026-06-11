/**
 * FR-140 IntegrationGateway tuning constants (LLD §Backend Flow / §Summary).
 *
 * These are deliberately CODE constants, not environment variables: the
 * environment-contract (docs/contracts/environment-contract.md) does not list
 * `REQUEST_TIMEOUT_MS`, `CIRCUIT_BREAKER_THRESHOLD`, `CIRCUIT_OPEN_TTL`, or
 * `MAX_RETRIES`, and an agent must not introduce a variable that is not in that
 * contract. The values match the LLD defaults; changing them is a code change
 * (and a deploy), which is the correct governance for a resilience policy.
 */

/** Hard per-call timeout enforced by an AbortController on the provider fetch. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Consecutive provider failures (within the window) that open the circuit. */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Seconds the circuit stays open before a half-open probe is allowed. */
export const CIRCUIT_OPEN_TTL_SECONDS = 60;

/** TTL (seconds) of the rolling failure-counter window for the breaker. */
export const CIRCUIT_FAILURE_WINDOW_SECONDS = 60;

/** Maximum retry attempts after the first call (so up to 1 + 3 dispatches). */
export const MAX_RETRIES = 3;

/** Backoff base: delay = BACKOFF_BASE_MS * 2^retryCount, then ± JITTER_RATIO. */
export const BACKOFF_BASE_MS = 1_000;

/** Proportional jitter applied to each backoff delay (±20%). */
export const BACKOFF_JITTER_RATIO = 0.2;

/** TTL (seconds) of the gateway idempotency cache entry (`idem:gw:{key}`). */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Redis key prefixes (single source so the gateway, breaker, and tests agree). */
export const REDIS_KEYS = {
  /** Gateway idempotency hash, by idempotency key. */
  gatewayIdem: (key: string): string => `idem:gw:${key}`,
  /** Webhook-create idempotency hash, by idempotency key. */
  webhookIdem: (key: string): string => `idem:webhook:${key}`,
  /** Circuit-breaker state hash, by integration kind. */
  circuitState: (kind: string): string => `cb:${kind}`,
  /** Circuit-breaker rolling failure counter, by integration kind. */
  circuitFailures: (kind: string): string => `cb:${kind}:failures`,
} as const;

/** Idempotency-cache record states (stored in the Redis hash `status` field). */
export const IDEM_STATE = {
  IN_FLIGHT: 'in_flight',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;
export type IdemState = (typeof IDEM_STATE)[keyof typeof IDEM_STATE];

/** Circuit-breaker states (stored in the Redis hash `state` field). */
export const CIRCUIT_STATE = {
  OPEN: 'open',
  HALF_OPEN: 'half_open',
} as const;
export type CircuitState = (typeof CIRCUIT_STATE)[keyof typeof CIRCUIT_STATE];

/** error_code written to integration_logs when a call is short-circuited. */
export const CB_OPEN_ERROR_CODE = 'CB_OPEN';

/**
 * The synthetic system actor for IntegrationGateway-owned writes. The gateway
 * runs outside any user request (it is also driven by Cloud Tasks retries), so
 * `created_by`/`updated_by` on `integration_logs` reference the seed system user
 * (schema.sql org/user seed `…0001`). Kept here so every gateway write agrees.
 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';
