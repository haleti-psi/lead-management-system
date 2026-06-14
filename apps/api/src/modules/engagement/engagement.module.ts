import { Module } from '@nestjs/common';

import { SLA_POLICY_READER_PORT } from '../../core/sla';
import { CommunicationController } from './communication.controller';
import { CommunicationRepository } from './communication.repository';
import { InternalTaskGuard } from './internal-task.guard';
import { TaskOverdueSweepJob } from './jobs/task-overdue-sweep.job';
import { NotificationDispatchService } from './notification-dispatch.service';
import { SlaPolicyController } from './sla-policy.controller';
import { SlaPolicyRepository } from './sla-policy.repository';
import { SlaPolicyService } from './sla-policy.service';
import { SlaSweepController } from './sla-sweep.controller';
import { TaskController } from './task.controller';
import { TaskSweepController } from './task-sweep.controller';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';
import { TemplateController } from './template.controller';
import { TemplateRepository } from './template.repository';
import { TemplateService } from './template.service';
import { DispatchCommunicationWorkerController } from './workers/dispatch-communication-worker.controller';
import { DispatchCommunicationWorker } from './workers/dispatch-communication.worker';

/**
 * M11 Engagement — FR-104 SLA + FR-100 Tasks + FR-101 Communication Templates & Audit.
 *
 * Extends the Wave-1 module with:
 *  - TemplateController / TemplateService / TemplateRepository (GET/POST /admin/templates)
 *  - CommunicationController / NotificationDispatchService / CommunicationRepository
 *    (POST /leads/{id}/communications — consent-gated send, 202 queued)
 *  - NotificationChannelPort resolves from the global IntegrationCoreModule (MockChannelAdapter
 *    in dev/test; M11 wires real adapters in production).
 *
 * LeadService resolves from the global @Global CaptureModule — do NOT re-provide.
 * NOTIFICATION_CHANNEL_PORT resolves from the global IntegrationCoreModule — do NOT re-provide.
 */
@Module({
  controllers: [
    SlaPolicyController,
    SlaSweepController,
    TaskController,
    TaskSweepController,
    TemplateController,
    CommunicationController,
    DispatchCommunicationWorkerController,
  ],
  providers: [
    // FR-104 SLA
    SlaPolicyService,
    SlaPolicyRepository,
    InternalTaskGuard,
    { provide: SLA_POLICY_READER_PORT, useExisting: SlaPolicyRepository },
    // FR-100 Task management
    TaskRepository,
    TaskService,
    TaskOverdueSweepJob,
    // FR-101 Communication Templates & Audit
    TemplateRepository,
    TemplateService,
    CommunicationRepository,
    NotificationDispatchService,
    DispatchCommunicationWorker,
  ],
  exports: [
    SlaPolicyService,
    SlaPolicyRepository,
    TaskService,
    TaskRepository,
    TemplateService,
    TemplateRepository,
    NotificationDispatchService,
  ],
})
export class EngagementModule {}
