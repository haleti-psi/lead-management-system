import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../config';
import { DomainException } from '../../http';
import {
  RETRY_WORKER_PATH,
  DEAD_LETTER_WORKER_PATH,
} from '../integration.routes';
import type {
  DeadLetterTask,
  RetryQueuePort,
  RetryTask,
} from '../retry-queue.port';

/**
 * Production {@link RetryQueuePort} backed by Cloud Tasks (dependency-register:
 * `@google-cloud/tasks`). It enqueues an HTTP task that calls back into this
 * service's retry/dead-letter worker endpoints (FR-141 boundary) after the
 * gateway-computed backoff delay. Queue, location, and project come from the
 * validated env (`CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_LOCATION`, `GCP_PROJECT`) —
 * never hardcoded. The task body carries only ids + counters (no PII/secrets).
 *
 * Wired ONLY in production by the integration module; dev/test use
 * {@link NoopRetryQueueAdapter}, so the test suite makes no GCP calls.
 */
@Injectable()
export class CloudTasksRetryQueueAdapter implements RetryQueuePort {
  /**
   * Lazily constructed so merely instantiating this provider (e.g. when the
   * non-prod factory injects it but binds the no-op instead) never reaches out
   * for GCP credentials. The client is built on first actual enqueue, which only
   * happens in production.
   */
  private clientInstance?: CloudTasksClient;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(CloudTasksRetryQueueAdapter.name) private readonly logger: PinoLogger,
  ) {}

  private get client(): CloudTasksClient {
    if (!this.clientInstance) {
      this.clientInstance = new CloudTasksClient();
    }
    return this.clientInstance;
  }

  async enqueueRetry(task: RetryTask): Promise<void> {
    await this.enqueue(
      RETRY_WORKER_PATH,
      {
        integration_log_id: task.integrationLogId,
        integration: task.integration,
        retry_count: task.retryCount,
      },
      task.delayMs,
    );
  }

  async enqueueDeadLetter(task: DeadLetterTask): Promise<void> {
    await this.enqueue(
      DEAD_LETTER_WORKER_PATH,
      {
        integration_log_id: task.integrationLogId,
        integration: task.integration,
        retry_count: task.retryCount,
        error_code: task.errorCode,
      },
      0,
    );
  }

  /** Build and submit one HTTP Cloud Task; failures map to UPSTREAM_UNAVAILABLE. */
  private async enqueue(path: string, body: Record<string, unknown>, delayMs: number): Promise<void> {
    const parent = this.client.queuePath(
      this.config.get('GCP_PROJECT'),
      this.config.get('CLOUD_TASKS_LOCATION'),
      this.config.get('CLOUD_TASKS_QUEUE'),
    );
    const url = `${this.config.get('APP_BASE_URL')}${path}`;
    const scheduleTime =
      delayMs > 0 ? { seconds: Math.floor((Date.now() + delayMs) / 1000) } : undefined;

    try {
      await this.client.createTask({
        parent,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(body)).toString('base64'),
          },
          ...(scheduleTime ? { scheduleTime } : {}),
        },
      });
    } catch (cause) {
      this.logger.error(
        { err: cause, integration: body.integration, path },
        'Cloud Tasks enqueue failed',
      );
      throw new DomainException('UPSTREAM_UNAVAILABLE', undefined, { cause });
    }
  }
}
