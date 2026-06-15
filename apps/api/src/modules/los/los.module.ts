import { Module } from '@nestjs/common';

import { ComplianceModule } from '../compliance/compliance.module';
import { EligibilityController } from './eligibility.controller';
import { EligibilityMappingValidator } from './eligibility-mapping.validator';
import { EligibilityPayloadBuilder } from './eligibility-payload.builder';
import { EligibilityRepository } from './eligibility.repository';
import { EligibilityService } from './eligibility.service';
import { LosHandoffController } from './los-handoff.controller';
import { LosHandoffPayloadBuilder } from './los-handoff-payload.builder';
import { LosHandoffService } from './los-handoff.service';
import { LosRepository } from './los.repository';
import { LosApplicationMirrorRepository } from './los-application-mirror.repository';
import { LosStatusController } from './los-status.controller';
import { LosStatusService } from './los-status.service';

/**
 * M9 LOS — FR-080 Eligibility Request, FR-081 LOS Hand-off, FR-082 Status Mirror.
 *
 * Depends on the global core modules (DB/UnitOfWork, audit, outbox, integration)
 * and the @Global CaptureModule (LeadService) registered in app.module.ts.
 * Imports ComplianceModule to access DataSharingService.logShare (FR-111 seam).
 *
 * FR-082 adds:
 *   - LosStatusController: POST /los/webhooks/status (@Public + LosWebhookGuard)
 *                          POST /internal/los/reconcile (@Public — infra-gated)
 *   - LosStatusService: processStatusUpdate(), reconcile()
 *   - LosApplicationMirrorRepository: upsertMirror(), findByLeadId(),
 *                                     findStaleHandedOffLeads()
 * LosWebhookGuard is provided + exported by the @Global IntegrationCoreModule.
 */
@Module({
  imports: [ComplianceModule],
  controllers: [EligibilityController, LosHandoffController, LosStatusController],
  providers: [
    EligibilityService,
    EligibilityRepository,
    EligibilityMappingValidator,
    EligibilityPayloadBuilder,
    LosHandoffService,
    LosHandoffPayloadBuilder,
    LosRepository,
    LosApplicationMirrorRepository,
    LosStatusService,
  ],
})
export class LosModule {}
