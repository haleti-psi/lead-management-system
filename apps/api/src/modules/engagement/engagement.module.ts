import { Module } from '@nestjs/common';

import { SLA_POLICY_READER_PORT } from '../../core/sla';
import { InternalTaskGuard } from './internal-task.guard';
import { TaskOverdueSweepJob } from './jobs/task-overdue-sweep.job';
import { SlaPolicyController } from './sla-policy.controller';
import { SlaPolicyRepository } from './sla-policy.repository';
import { SlaPolicyService } from './sla-policy.service';
import { SlaSweepController } from './sla-sweep.controller';
import { TaskController } from './task.controller';
import { TaskSweepController } from './task-sweep.controller';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';

/**
 * M11 Engagement — FR-104 SLA policy administration + FR-100 Task Management.
 *
 * Depends on the global core modules (DB, audit, outbox, auth-core, config,
 * and the global `SlaModule`). Also imports `LeadService` from the capture
 * module for the nurture task `setNurtureNextAt` side-effect (FR-100 §Data
 * Operations — sole-writer rule: only `LeadService` writes `leads`).
 *
 * Binds {@link SLA_POLICY_READER_PORT} to {@link SlaPolicyRepository} so the
 * global `SlaEngine` resolves the governing policy through this module's owner
 * repository (the engine stays decoupled from M11's repository class).
 *
 * Exports {@link TaskService} so FR-062 (customer callback), FR-031 (hot-rule
 * H7), and other FRs that read tasks can consume it without re-implementing.
 */
@Module({
  controllers: [SlaPolicyController, SlaSweepController, TaskController, TaskSweepController],
  providers: [
    SlaPolicyService,
    SlaPolicyRepository,
    InternalTaskGuard,
    { provide: SLA_POLICY_READER_PORT, useExisting: SlaPolicyRepository },
    // FR-100: Task management
    // LeadService resolves from the global @Global CaptureModule (sole writer of
    // leads); do NOT re-provide it here — a duplicate provider would create an
    // independent singleton without the correct AuditAppender/OutboxService wiring.
    TaskRepository,
    TaskService,
    TaskOverdueSweepJob,
  ],
  exports: [SlaPolicyService, SlaPolicyRepository, TaskService, TaskRepository],
})
export class EngagementModule {}
