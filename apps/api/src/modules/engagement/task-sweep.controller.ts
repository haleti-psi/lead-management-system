import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../../core/auth';
import { InternalTaskGuard } from './internal-task.guard';
import { TaskOverdueSweepJob } from './jobs/task-overdue-sweep.job';

/**
 * FR-100 — internal task overdue-sweep endpoint (`POST /api/v1/internal/tasks/overdue-sweep`).
 *
 * Driven by Cloud Scheduler → Cloud Tasks (every ~5 minutes), NOT by a user.
 * It is `@Public()` (exempt from the global JwtAuthGuard) and instead protected
 * by {@link InternalTaskGuard}, which requires the Cloud Tasks queue header — a
 * user JWT can never reach it.
 */
@Controller('internal/tasks')
@Public()
@SkipThrottle() // server-to-server traffic; not subject to the per-IP user throttle
@UseGuards(InternalTaskGuard)
export class TaskSweepController {
  constructor(private readonly job: TaskOverdueSweepJob) {}

  @Post('overdue-sweep')
  @HttpCode(200)
  async sweep(): Promise<{ marked_overdue: number }> {
    const count = await this.job.run();
    return { marked_overdue: count };
  }
}
