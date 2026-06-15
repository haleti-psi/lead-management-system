import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { Public } from '../../core/auth';
import { InternalTaskGuard } from '../engagement/internal-task.guard';
import { getCorrelationId, type CorrelatedRequest } from '../../core/http';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import { GrievanceService } from './grievance.service';

/**
 * FR-114 — Cloud Tasks HTTP worker for the grievance escalation sweep.
 *
 * The Cloud Scheduler → Cloud Tasks pattern: a Cloud Scheduler job fires a
 * Cloud Tasks task targeting this endpoint on a configurable schedule (e.g.
 * every 30 minutes). The endpoint is `@Public()` because Cloud Tasks forwards
 * requests with an OIDC service-account token, not a user JWT — a dedicated
 * Cloud Tasks IAM guard (outside this FR's scope) validates the OIDC token at
 * the infrastructure layer.
 *
 * This handler calls {@link GrievanceService.runEscalationSweep}, which wraps
 * each grievance update in its own UnitOfWork transaction (so one failure does
 * not abort the rest of the batch), appends audit entries, and logs a structured
 * summary at the end.
 */
@Controller('internal/jobs/grievance-escalation')
@SkipThrottle()
@UseGuards(InternalTaskGuard)
export class GrievanceEscalationJob {
  constructor(
    private readonly grievances: GrievanceService,
    @InjectPinoLogger(GrievanceEscalationJob.name) private readonly logger: PinoLogger,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  async run(@Req() req: CorrelatedRequest): Promise<{ escalatedCount: number }> {
    const correlationId = getCorrelationId(req) ?? 'job_unknown';
    this.logger.info(
      { correlationId, job: 'grievance-escalation' },
      'Grievance escalation sweep started',
    );

    const escalatedCount = await this.grievances.runEscalationSweep(
      ORG_ID_DEFAULT,
      new Date(),
    );

    this.logger.info(
      { correlationId, job: 'grievance-escalation', escalatedCount },
      'Grievance escalation sweep finished',
    );

    return { escalatedCount };
  }
}
