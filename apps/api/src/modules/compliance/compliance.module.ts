import { Module } from '@nestjs/common';

import { ConsentController } from './consent.controller';
import { ConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';
import { CustomerConsentController } from './customer-consent.controller';

/**
 * M12 Compliance — FR-110 (purpose-wise consent ledger; `consent_records`
 * owner, append-only). Depends only on the global core modules (DB/UnitOfWork,
 * audit, outbox, auth-core, logging) plus the @Global CaptureModule's
 * `LeadService` (sole writer of `leads` — `setConsentStatus` lands with this
 * FR). Later M12 FRs (FR-112/113/114/115) extend this module.
 *
 * `CUSTOMER_LINK_PORT` (consumed by `CustomerConsentController` / `ConsentService`)
 * is now bound by the @Global `SelfServiceModule` (FR-060) to the real
 * `CustomerLinkAdapter` — it resolved no token while behind FR-110's
 * `UnavailableCustomerLinkAdapter`. The port symbol + the fallback adapter still
 * live in `ports/customer-link.port.ts`.
 *
 * `ConsentService` is exported for the consent-gating consumers (stage-guard
 * hand-off checks, engagement dispatch gates) that read the ledger.
 */
@Module({
  controllers: [ConsentController, CustomerConsentController],
  providers: [ConsentService, ConsentRepository],
  exports: [ConsentService, ConsentRepository],
})
export class ComplianceModule {}
