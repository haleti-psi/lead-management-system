import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../../core/config';
import { LEAD_SLA_WRITER_PORT } from '../../core/sla';
import { LeadReassignmentAdapter } from './adapters/lead-reassignment.adapter';
import { LeadSlaWriterAdapter } from './adapters/lead-sla-writer.adapter';
import { CaptureController } from './capture.controller';
import { CaptureIdempotencyService } from './capture-idempotency.service';
import { CaptureService } from './capture.service';
import { CodeGenerator } from './code-generator.service';
import { CustomerProfileRepository } from './customer-profile.repository';
import { ImportProcessorService } from './import-processor.job';
import { LeadIdentityRepository } from './lead-identity.repository';
import { LeadService } from './lead.service';
import { PublicCaptureController } from './public-capture.controller';
import { SourceAttributionRepository } from './source-attribution.repository';
import { GcsImportFileStoreAdapter } from './ports/gcs-import-file-store.adapter';
import { IMPORT_DISPATCH_PORT } from './ports/import-dispatch.port';
import { IMPORT_FILE_STORE_PORT } from './ports/import-file-store.port';
import { InMemoryImportFileStoreAdapter } from './ports/in-memory-import-file-store.adapter';
import { InlineImportDispatchAdapter } from './ports/inline-import-dispatch.adapter';
/**
 * M2 Lead Capture — FR-010 (omnichannel capture + `LeadService`, the sole
 * writer of `leads`). Depends only on the global core modules (DB/UnitOfWork,
 * audit, outbox, auth-core, masking, redis, config, integration, sla).
 *
 * `@Global` because this module OWNS the lead write path and binds the
 * cross-module seams other (already-global) modules consume:
 *   - {@link LEAD_SLA_WRITER_PORT} → {@link LeadSlaWriterAdapter} — the Wave-1
 *     `core/sla` "WIRE-LATER (FR-010)" seam; the global SlaEngine resolves it
 *     only from a global module's exports (the Wave-1 cross-module-provider
 *     learning).
 *   - {@link LeadReassignmentAdapter} — exported for AdminModule, which rebinds
 *     its FR-130 `LEAD_REASSIGN_PORT` placeholder to it (admin.module.ts).
 *
 * FR-011 (scoring): `SCORING_PORT` is bound by the @Global `AllocationModule`
 * (which registers `ScoringAdapter` and re-exports the token). CaptureService
 * injects it from the global provider graph — no binding needed here. This is
 * the same pattern as `DUPLICATE_CHECK_PORT` (bound by @Global DedupeModule).
 */
@Global()
@Module({
  controllers: [CaptureController, PublicCaptureController],
  providers: [
    LeadService,
    CaptureService,
    CaptureIdempotencyService,
    CodeGenerator,
    LeadIdentityRepository,
    SourceAttributionRepository,
    CustomerProfileRepository,
    ImportProcessorService,
    // Seam adapters (owner side).
    LeadSlaWriterAdapter,
    LeadReassignmentAdapter,
    { provide: LEAD_SLA_WRITER_PORT, useExisting: LeadSlaWriterAdapter },
    // SCORING_PORT is bound by AllocationModule (FR-011 ScoringAdapter) — the
    // @Global AllocationModule registers the real adapter and re-exports the
    // token, so CaptureService can inject it here via the global provider graph.
    // Bulk-import infrastructure: GCS in production, in-memory in dev/test
    // (outbox-publisher / retry-queue convention — no live GCP in the suite).
    GcsImportFileStoreAdapter,
    InMemoryImportFileStoreAdapter,
    {
      provide: IMPORT_FILE_STORE_PORT,
      useFactory: (
        config: AppConfigService,
        gcs: GcsImportFileStoreAdapter,
        memory: InMemoryImportFileStoreAdapter,
      ) => (config.isProduction ? gcs : memory),
      inject: [AppConfigService, GcsImportFileStoreAdapter, InMemoryImportFileStoreAdapter],
    },
    // In-process dispatch until the Cloud-Tasks worker endpoint is contracted
    // (see import-dispatch.port.ts).
    { provide: IMPORT_DISPATCH_PORT, useClass: InlineImportDispatchAdapter },
  ],
  exports: [
    LeadService,
    CaptureService,
    LeadSlaWriterAdapter,
    LeadReassignmentAdapter,
    LEAD_SLA_WRITER_PORT,
  ],
})
export class CaptureModule {}
