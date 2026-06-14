import { Module } from '@nestjs/common';

import { SLA_POLICY_READER_PORT } from '../../core/sla';
import {
  CUSTOMER_LINK_PORT,
  UnavailableCustomerLinkAdapter,
} from '../compliance/ports/customer-link.port';
import { CommunicationController } from './communication.controller';
import { CommunicationRepository } from './communication.repository';
import { CustomerPreferenceController } from './customer-preference.controller';
import { InternalTaskGuard } from './internal-task.guard';
import { TaskOverdueSweepJob } from './jobs/task-overdue-sweep.job';
import { NotificationDispatchService } from './notification-dispatch.service';
import { PreferenceController } from './preference.controller';
import { PreferenceRepository } from './preference.repository';
import { PreferenceService } from './preference.service';
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
 * M11 Engagement — FR-104 SLA + FR-100 Tasks + FR-101 Communication Templates & Audit
 *                  + FR-103 Notification Preference Centre.
 *
 * Extends the Wave-1 module with:
 *  - TemplateController / TemplateService / TemplateRepository (GET/POST /admin/templates)
 *  - CommunicationController / NotificationDispatchService / CommunicationRepository
 *    (POST /leads/{id}/communications — consent-gated send, 202 queued)
 *  - PreferenceController / PreferenceService / PreferenceRepository
 *    (PUT/GET /preferences — batch upsert + read for internal staff)
 *  - CustomerPreferenceController
 *    (PUT/GET /c/{token}/preferences — self-service via opaque link token)
 *  - NotificationChannelPort resolves from the global IntegrationCoreModule.
 *
 * LeadService resolves from the global @Global CaptureModule — do NOT re-provide.
 * NOTIFICATION_CHANNEL_PORT resolves from the global IntegrationCoreModule — do NOT re-provide.
 *
 * CUSTOMER_LINK_PORT: FR-060 seam (same adapter as ComplianceModule). When FR-060
 * lands, rebind `UnavailableCustomerLinkAdapter` to the real link service here
 * (one-line change, same as compliance.module.ts).
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
    // FR-103
    PreferenceController,
    CustomerPreferenceController,
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
    // FR-103 Notification Preference Centre
    PreferenceRepository,
    PreferenceService,
    // FR-060 seam — resolves NO token until FR-060 lands (same as compliance.module.ts).
    UnavailableCustomerLinkAdapter,
    { provide: CUSTOMER_LINK_PORT, useExisting: UnavailableCustomerLinkAdapter },
  ],
  exports: [
    SlaPolicyService,
    SlaPolicyRepository,
    TaskService,
    TaskRepository,
    TemplateService,
    TemplateRepository,
    NotificationDispatchService,
    // FR-103 — exported so other modules can call isAllowed() for opt-out checks.
    PreferenceService,
    PreferenceRepository,
  ],
})
export class EngagementModule {}
