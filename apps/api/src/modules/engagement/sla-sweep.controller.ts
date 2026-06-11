import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { SlaEngine, type SweepResult } from '../../core/sla';
import { InternalTaskGuard } from './internal-task.guard';

/**
 * FR-104 — internal SLA sweep endpoint (`POST /api/v1/internal/sla/sweep`).
 *
 * Driven by Cloud Scheduler → Cloud Tasks (every minute), NOT by a user. It is
 * `@Public()` (exempt from the global JwtAuthGuard) and instead protected by
 * {@link InternalTaskGuard}, which requires the Cloud Tasks queue header — a user
 * JWT can never reach it. The whole sweep runs in ONE {@link UnitOfWork}
 * transaction so the event emissions (and any breach reassignment) commit
 * atomically; the engine's idempotency keeps repeat ticks safe.
 */
@Controller('internal/sla')
@Public()
@SkipThrottle() // server-to-server traffic; not subject to the per-IP user throttle
@UseGuards(InternalTaskGuard)
export class SlaSweepController {
  constructor(
    private readonly engine: SlaEngine,
    private readonly uow: UnitOfWork,
  ) {}

  @Post('sweep')
  @HttpCode(200)
  async sweep(): Promise<SweepResult> {
    return this.uow.run((tx) => this.engine.sweep(tx));
  }
}
