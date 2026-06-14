import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';

import { Public } from '../../../core/auth';
import { ZodValidationPipe } from '../../../core/common';
import { InternalTaskGuard } from '../internal-task.guard';
import { DispatchCommunicationWorker, type DispatchCommunicationTask } from './dispatch-communication.worker';

/** Body schema for the Cloud Tasks dispatch payload. */
const DispatchTaskBody = z.object({
  communication_log_id: z.string().uuid('communication_log_id must be a valid UUID'),
});

/**
 * FR-101 — internal Cloud Tasks endpoint for async communication dispatch.
 *
 * POST /api/v1/internal/communications/dispatch
 *
 * Driven by Cloud Tasks after {@link NotificationDispatchService} enqueues a
 * communication_logs row with status='queued'. It is `@Public()` (exempt from
 * the global JwtAuthGuard) and instead protected by {@link InternalTaskGuard},
 * which requires the Cloud Tasks queue header — a user JWT can never reach it.
 *
 * Idempotency is handled inside the worker: if the log row is already
 * 'sent'/'delivered', the call is a no-op. Cloud Tasks retries on any non-2xx
 * response; the worker does NOT throw on provider errors (it marks the row
 * 'failed' and returns 200 so the task is acked — DLQ handles final failure).
 */
@Controller('internal/communications')
@Public()
@SkipThrottle() // server-to-server traffic; not subject to the per-IP user throttle
@UseGuards(InternalTaskGuard)
export class DispatchCommunicationWorkerController {
  constructor(private readonly worker: DispatchCommunicationWorker) {}

  @Post('dispatch')
  @HttpCode(200)
  async dispatch(
    @Body(new ZodValidationPipe(DispatchTaskBody)) body: DispatchCommunicationTask,
  ): Promise<void> {
    await this.worker.run(body);
  }
}
