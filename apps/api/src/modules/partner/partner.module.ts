import { Module } from '@nestjs/common';

import { PartnerController } from './partner.controller';
import { PartnerLeadController } from './partner-lead.controller';
import { PartnerLeadRepository } from './partner-lead.repository';
import { PartnerLeadService } from './partner-lead.service';
import { PartnerQualityController } from './partner-quality.controller';
import { PartnerQualityRepository } from './partner-quality.repository';
import { PartnerQualityService } from './partner-quality.service';
import { PartnerRepository } from './partner.repository';
import { PartnerService } from './partner.service';

/**
 * M10 Partner — FR-090 (Partner master CRUD; sole writer of `partners`) +
 * FR-091 (partner lead submission — a P-scoped facade over the @Global
 * CaptureService/FR-010 pipeline). Depends on the global core modules and the
 * @Global CaptureModule (`CaptureService`) + FR-092 (partner quality score &
 * dashboard — aggregate read + cached `quality_score`).
 */
@Module({
  controllers: [PartnerController, PartnerLeadController, PartnerQualityController],
  providers: [
    PartnerService,
    PartnerRepository,
    PartnerLeadService,
    PartnerLeadRepository,
    PartnerQualityService,
    PartnerQualityRepository,
  ],
  exports: [PartnerService],
})
export class PartnerModule {}
