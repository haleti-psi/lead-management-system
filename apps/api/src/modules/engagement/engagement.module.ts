import { Module } from '@nestjs/common';

import { SLA_POLICY_READER_PORT } from '../../core/sla';
import { InternalTaskGuard } from './internal-task.guard';
import { SlaPolicyController } from './sla-policy.controller';
import { SlaPolicyRepository } from './sla-policy.repository';
import { SlaPolicyService } from './sla-policy.service';
import { SlaSweepController } from './sla-sweep.controller';

/**
 * M11 Engagement — FR-104 SLA policy administration + the internal SLA sweep
 * endpoint. Depends on the global core modules (DB, audit, outbox, auth-core,
 * config, and the global `SlaModule`).
 *
 * Binds {@link SLA_POLICY_READER_PORT} to {@link SlaPolicyRepository} so the
 * global `SlaEngine` resolves the governing policy through this module's owner
 * repository (the engine stays decoupled from M11's repository class). The
 * lead/KYC/grievance WRITER ports remain unbound until M2/KYC/M12 are built.
 */
@Module({
  controllers: [SlaPolicyController, SlaSweepController],
  providers: [
    SlaPolicyService,
    SlaPolicyRepository,
    InternalTaskGuard,
    { provide: SLA_POLICY_READER_PORT, useExisting: SlaPolicyRepository },
  ],
  exports: [SlaPolicyService, SlaPolicyRepository],
})
export class EngagementModule {}
