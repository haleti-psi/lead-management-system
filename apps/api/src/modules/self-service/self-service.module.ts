import { Global, Module } from '@nestjs/common';

import { CUSTOMER_LINK_PORT } from '../compliance/ports/customer-link.port';
import { CustomerLinkAdapter } from './customer-link.adapter';
import { CustomerLinkController } from './customer-link.controller';
import { CustomerLinkGuard } from './customer-link.guard';
import { CustomerLinkRepository } from './customer-link.repository';
import { CustomerLinkService } from './customer-link.service';
import { CustomerPublicController } from './customer-public.controller';
import { GrievanceController } from './grievance.controller';
import { GrievanceRepository } from './grievance.repository';
import { GrievanceService } from './grievance.service';
import { OtpService } from './otp.service';

/**
 * M7 Customer Self-Service — FR-060 (secure customer action link; sole writer of
 * `customer_links`). `@Global` so it can REBIND the `CUSTOMER_LINK_PORT` seam that
 * FR-070 (customer upload) and FR-110 (customer consent) left behind the
 * `UnavailableCustomerLinkAdapter`: the real {@link CustomerLinkAdapter} now
 * resolves tokens for those endpoints. Depends only on global core modules
 * (DB/UnitOfWork, audit, outbox, integration notification port, Redis, config).
 */
@Global()
@Module({
  controllers: [CustomerLinkController, CustomerPublicController, GrievanceController],
  providers: [
    CustomerLinkService,
    CustomerLinkRepository,
    OtpService,
    CustomerLinkGuard,
    CustomerLinkAdapter,
    GrievanceService,
    GrievanceRepository,
    { provide: CUSTOMER_LINK_PORT, useExisting: CustomerLinkAdapter },
  ],
  exports: [CUSTOMER_LINK_PORT, CustomerLinkService],
})
export class SelfServiceModule {}
