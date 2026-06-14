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
 *                  + FR-102 Telephony & Visit Logging + FR-103 Notification Preference Centre.
 *
 * FR-102 adds disposition logging to the PATCH /tasks/{id} endpoint:
 *  - TaskService.logDisposition() writes task disposition + CommunicationLog +
 *    audit + outbox event in one UnitOfWork transaction.
 *  - Post-commit CTI sync via TelephonyPort (Phase 1.5; IntegrationGateway).
 *
 * LeadService resolves from the global @Global CaptureModule — do NOT re-provide.
 * IntegrationGateway, TELEPHONY_PORT, OutboxService resolve from global modules.
 * NOTIFICATION_CHANNEL_PORT resolves from the global IntegrationCoreModule — do NOT re-provide.
 *
 * CUSTOMER_LINK_PORT: FR-060 seam (same adapter as ComplianceModule).
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
