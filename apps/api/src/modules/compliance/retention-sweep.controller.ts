import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { Public } from '../../core/auth';
import { getCorrelationId, type CorrelatedRequest } from '../../core/http';
import { InternalTaskGuard } from '../engagement/internal-task.guard';
import { RetentionEngine } from './retention.engine';

/**
 * FR-115 — Cloud Tasks HTTP worker for the autonomous retention sweep.
 *
 * Cloud Scheduler (`RETENTION_CRON_SCHEDULE`, default 02:00 IST) → Cloud Tasks
 * fires this endpoint with NO user JWT. It is `@Public()` (exempt from the global
 * JwtAuthGuard) and instead protected by {@link InternalTaskGuard}, which requires
 * the Cloud Tasks queue header — a user JWT can never reach it (mirrors
 * `SlaSweepController` / `GrievanceEscalationJob`).
 *
 * Because there is no caller scope, it enumerates every org that has an active
 * retention policy and runs the per-org purge/anonymise engine for each
 * ({@link RetentionEngine.sweepAllOrgs}); every lead is processed in its own
 * UnitOfWork transaction and audited, and one org's failure never aborts the rest.
 */
@Controller('internal/jobs/retention-sweep')
@SkipThrottle()
@UseGuards(InternalTaskGuard)
export class RetentionSweepController {
  constructor(
    private readonly engine: RetentionEngine,
    @InjectPinoLogger(RetentionSweepController.name) private readonly logger: PinoLogger,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  async run(@Req() req: CorrelatedRequest): Promise<{ runId: string; orgsSwept: number }> {
    const runId = randomUUID();
    const correlationId = getCorrelationId(req) ?? 'job_unknown';

    this.logger.info(
      { correlationId, runId, job: 'retention-sweep' },
      'Retention sweep started',
    );

    const { orgsSwept } = await this.engine.sweepAllOrgs(runId);

    this.logger.info(
      { correlationId, runId, job: 'retention-sweep', orgsSwept },
      'Retention sweep finished',
    );

    return { runId, orgsSwept };
  }
}
