import { Module } from '@nestjs/common';

import { ConsentController } from './consent.controller';
import { ConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';
import { CustomerConsentController } from './customer-consent.controller';
import {
  CUSTOMER_LINK_PORT,
  UnavailableCustomerLinkAdapter,
} from './ports/customer-link.port';

/**
 * M12 Compliance — FR-110 (purpose-wise consent ledger; `consent_records`
 * owner, append-only). Depends only on the global core modules (DB/UnitOfWork,
 * audit, outbox, auth-core, logging) plus the @Global CaptureModule's
 * `LeadService` (sole writer of `leads` — `setConsentStatus` lands with this
 * FR). Later M12 FRs (FR-112/113/114/115) extend this module.
 *
 * `CUSTOMER_LINK_PORT` is the FR-060 seam: the customer micro-site token +
 * OTP machinery is owned by M7. Until FR-060 lands the bound adapter resolves
 * no token (every `/c/{token}/consent` → 404); FR-060 rebinds it here.
 *
 * `ConsentService` is exported for the consent-gating consumers (stage-guard
 * hand-off checks, engagement dispatch gates) that read the ledger.
 */
@Module({
  controllers: [ConsentController, CustomerConsentController],
  providers: [
    ConsentService,
    ConsentRepository,
    UnavailableCustomerLinkAdapter,
    { provide: CUSTOMER_LINK_PORT, useExisting: UnavailableCustomerLinkAdapter },
  ],
  exports: [ConsentService, ConsentRepository],
})
export class ComplianceModule {}
