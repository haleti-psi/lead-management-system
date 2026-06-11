import type { IntegrationKind } from '@lms/shared';

/** A retry task the gateway hands to Cloud Tasks (LLD §Backend Flow step 7). */
export interface RetryTask {
  integrationLogId: string;
  integration: IntegrationKind;
  /** The attempt number this retry will perform (1-based: first retry = 1). */
  retryCount: number;
  /** Delay before the task becomes eligible, with backoff + jitter applied. */
  delayMs: number;
}

/** A poison-message task routed for operational review (LLD step 7, max retries). */
export interface DeadLetterTask {
  integrationLogId: string;
  integration: IntegrationKind;
  /** Final attempt count reached before giving up. */
  retryCount: number;
  /** Last recorded failure code (≤60 chars; no PII). */
  errorCode: string | null;
}

/**
 * Outbound retry/dead-letter queue boundary (architecture §2; ADR — Cloud Tasks
 * owns retries). The {@link IntegrationGateway} depends only on this port, so the
 * real `@google-cloud/tasks` client is swapped for a no-op double in dev/test
 * (no live GCP calls in the test suite). The DI token is a symbol for the same
 * per-environment swap the other ports use.
 */
export interface RetryQueuePort {
  /** Enqueue a delayed retry of a failed integration call. */
  enqueueRetry(task: RetryTask): Promise<void>;
  /** Enqueue a poison message for operational follow-up after max retries. */
  enqueueDeadLetter(task: DeadLetterTask): Promise<void>;
}

export const RETRY_QUEUE_PORT = Symbol('RETRY_QUEUE_PORT');
