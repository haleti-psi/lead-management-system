import { Module } from '@nestjs/common';

import { GRIEVANCE_SLA_WRITER_PORT } from '../../core/sla/sla.ports';
import { ConsentController } from './consent.controller';
import { ConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';
import { CustomerConsentController } from './customer-consent.controller';
import { CustomerDataRightsController } from './customer-data-rights.controller';
import { DataMinimisationService } from './data-minimisation.service';
import { DataRightsController } from './data-rights.controller';
import { DataRightsIdempotencyService } from './data-rights-idempotency.service';
import { DataRightsRepository } from './data-rights.repository';
import { DataRightsService } from './data-rights.service';
import { DataSharingLogsController } from './data-sharing-logs.controller';
import { DataSharingLogsRepository } from './data-sharing-logs.repository';
import { DataSharingLogsService } from './data-sharing-logs.service';
import { DataSharingService } from './data-sharing.service';
import { DlaRegistryController } from './dla-registry.controller';
import { DlaRegistryRepository } from './dla-registry.repository';
import { DlaRegistryService } from './dla-registry.service';
import { GrievanceCodeGenerator } from './code-generator-grievance.service';
import { GrievanceController } from './grievance.controller';
import { GrievanceEscalationJob } from './grievance-escalation.job';
import { GrievanceIdempotencyService } from './grievance-idempotency.service';
import { GrievanceRepository } from './grievance.repository';
import { GrievanceService } from './grievance.service';
import { GrievanceSlaWriterAdapter } from './grievance-sla-writer.adapter';
import { RetentionEngine } from './retention.engine';
import { RetentionPolicyController } from './retention-policy.controller';
import { RetentionPolicyRepository } from './retention-policy.repository';
import {
  CUSTOMER_LINK_PORT,
  UnavailableCustomerLinkAdapter,
} from './ports/customer-link.port';

/**
 * M12 Compliance — FR-110 (purpose-wise consent ledger) + FR-111 (data
 * minimisation & resource-access controls) + FR-112 (data-principal rights
 * workflow) + FR-113 (DLA/LSP registry) + FR-114 (grievance workflow) +
 * FR-115 (data retention, purge & anonymisation engine).
 *
 * Owns `consent_records` (append-only), `data_sharing_logs` (append-only),
 * `grievances` (full lifecycle), `dla_registry` (FR-113), and `retention_policies`
 * (FR-115). Depends only on the global core modules
 * (DB/UnitOfWork, audit, outbox, auth-core, sla, logging) plus the @Global
 * CaptureModule's `LeadService`.
 *
 * **FR-111 reuse seams:**
 * - `DataSharingService.logShare(input, tx)` is exported for FR-080
 *   (EligibilityService), FR-081 (HandoffService), and FR-071 (KycService) to
 *   call inside their own UnitOfWork transactions. Each consuming FR must
 *   inject `DataSharingService` from this module (import ComplianceModule).
 * - `DataMinimisationService.assertAllowed(productConfigId, fields)` is
 *   exported for `LeadService` (FR-010) and document-capture services to call
 *   before persisting custom field values.
 *
 * **FR-114 reuse seam for FR-061:** `GrievanceService.create(dto, ctx)` is
 * exported and will be called by the self-service module (M7/FR-061) with
 * `source = 'customer_link'` when that FR is built. No modification to this
 * module is required; FR-061 imports `GrievanceService` from here.
 *
 * **GRIEVANCE_SLA_WRITER_PORT** — binds the M12-side adapter that the core
 * `SlaEngine` calls to write `grievances.sla_due_at` without violating
 * owner-writes (the SLA engine never touches `grievances` directly).
 *
 * `CUSTOMER_LINK_PORT` is the FR-060 seam: every `/c/{token}/consent` request
 * → 404 until FR-060 rebinds the port in this module.
 *
 * `ConsentService`, `GrievanceService`, `DataSharingService`, and
 * `DataMinimisationService` are exported for consumers.
 */
@Module({
  controllers: [
    ConsentController,
    CustomerConsentController,
    CustomerDataRightsController,
    DataRightsController,
    DataSharingLogsController,
    DlaRegistryController,
    GrievanceController,
    GrievanceEscalationJob,
    // FR-115 — retention policy CRUD + run trigger
    RetentionPolicyController,
  ],
  providers: [
    // FR-110 — consent
    ConsentService,
    ConsentRepository,
    UnavailableCustomerLinkAdapter,
    { provide: CUSTOMER_LINK_PORT, useExisting: UnavailableCustomerLinkAdapter },

    // FR-111 — data minimisation & data-sharing audit
    DataSharingService,
    DataSharingLogsService,
    DataSharingLogsRepository,
    DataMinimisationService,

    // FR-112 — data-principal rights workflow
    DataRightsService,
    DataRightsRepository,
    DataRightsIdempotencyService,

    // FR-113 — DLA/LSP registry
    DlaRegistryService,
    DlaRegistryRepository,

    // FR-114 — grievance
    GrievanceService,
    GrievanceRepository,
    GrievanceCodeGenerator,
    GrievanceIdempotencyService,
    GrievanceSlaWriterAdapter,
    {
      provide: GRIEVANCE_SLA_WRITER_PORT,
      useExisting: GrievanceSlaWriterAdapter,
    },

    // FR-115 — retention engine + policy repository
    RetentionEngine,
    RetentionPolicyRepository,
  ],
  exports: [
    ConsentService,
    ConsentRepository,
    GrievanceService,
    // FR-111 exports — consumed by FR-010, FR-071, FR-080, FR-081
    DataSharingService,
    DataMinimisationService,
  ],
})
export class ComplianceModule {}
