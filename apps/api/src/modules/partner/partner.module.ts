import { Module } from '@nestjs/common';

import { PartnerController } from './partner.controller';
import { PartnerRepository } from './partner.repository';
import { PartnerService } from './partner.service';

/**
 * M10 Partner — FR-090 (Partner master CRUD; sole writer of `partners`). Depends
 * only on the global core modules (DB/UnitOfWork, audit, auth-core). Later M10
 * FRs (FR-091 partner submission, FR-092) extend this module.
 */
@Module({
  controllers: [PartnerController],
  providers: [PartnerService, PartnerRepository],
  exports: [PartnerService],
})
export class PartnerModule {}
