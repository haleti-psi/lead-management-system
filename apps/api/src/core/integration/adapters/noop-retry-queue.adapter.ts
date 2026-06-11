import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import type {
  DeadLetterTask,
  RetryQueuePort,
  RetryTask,
} from '../retry-queue.port';

/**
 * Default {@link RetryQueuePort} for non-production builds and tests. It performs
 * no GCP I/O — it records the intent at debug level (no PII; only ids, the kind,
 * and the delay) so local runs and the test suite never reach Cloud Tasks. The
 * real {@link CloudTasksRetryQueueAdapter} is wired by the module in production.
 */
@Injectable()
export class NoopRetryQueueAdapter implements RetryQueuePort {
  constructor(
    @InjectPinoLogger(NoopRetryQueueAdapter.name) private readonly logger: PinoLogger,
  ) {}

  async enqueueRetry(task: RetryTask): Promise<void> {
    this.logger.debug(
      {
        integration_log_id: task.integrationLogId,
        integration: task.integration,
        retry_count: task.retryCount,
        delay_ms: task.delayMs,
      },
      'NoopRetryQueue: retry enqueue (no-op)',
    );
    await Promise.resolve();
  }

  async enqueueDeadLetter(task: DeadLetterTask): Promise<void> {
    this.logger.debug(
      {
        integration_log_id: task.integrationLogId,
        integration: task.integration,
        retry_count: task.retryCount,
        error_code: task.errorCode,
      },
      'NoopRetryQueue: dead-letter enqueue (no-op)',
    );
    await Promise.resolve();
  }
}
