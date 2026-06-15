import { Module } from '@nestjs/common';

import { ComplianceModule } from '../compliance/compliance.module';
import { EligibilityController } from './eligibility.controller';
import { EligibilityMappingValidator } from './eligibility-mapping.validator';
import { EligibilityPayloadBuilder } from './eligibility-payload.builder';
import { EligibilityRepository } from './eligibility.repository';
import { EligibilityService } from './eligibility.service';

/**
 * M9 LOS — FR-080 Eligibility Request & Read-Only Snapshot.
 *
 * Depends on the global core modules (DB/UnitOfWork, audit, outbox, integration)
 * and the @Global CaptureModule (LeadService) registered in app.module.ts.
 * Imports ComplianceModule to access DataSharingService.logShare (FR-111 seam).
 */
@Module({
  imports: [ComplianceModule],
  controllers: [EligibilityController],
  providers: [
    EligibilityService,
    EligibilityRepository,
    EligibilityMappingValidator,
    EligibilityPayloadBuilder,
  ],
})
export class LosModule {}
