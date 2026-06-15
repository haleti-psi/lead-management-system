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

/**
 * M9 LOS — FR-080 Eligibility Request & FR-081 LOS Hand-off.
 *
 * Depends on the global core modules (DB/UnitOfWork, audit, outbox, integration)
 * and the @Global CaptureModule (LeadService) registered in app.module.ts.
 * Imports ComplianceModule to access DataSharingService.logShare (FR-111 seam).
 */
@Module({
  imports: [ComplianceModule],
  controllers: [EligibilityController, LosHandoffController],
  providers: [
    EligibilityService,
    EligibilityRepository,
    EligibilityMappingValidator,
    EligibilityPayloadBuilder,
    LosHandoffService,
    LosHandoffPayloadBuilder,
    LosRepository,
  ],
})
export class LosModule {}
