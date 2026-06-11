/**
 * Internal HTTP paths Cloud Tasks calls back into for retry / dead-letter
 * processing (the worker handlers are FR-141's boundary). Kept as constants so
 * the {@link CloudTasksRetryQueueAdapter} target and any future worker
 * controller agree on one path. These are service-to-service routes, protected
 * by the Cloud Tasks OIDC/queue identity at deploy time (not user JWT).
 */
export const RETRY_WORKER_PATH = '/api/v1/internal/integration/retry';
export const DEAD_LETTER_WORKER_PATH = '/api/v1/internal/integration/dead-letter';
