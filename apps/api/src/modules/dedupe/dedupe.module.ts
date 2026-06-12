import { Global, Module } from '@nestjs/common';

import { DUPLICATE_CHECK_PORT } from '../capture/ports/duplicate-check.port';
import { DedupeController } from './dedupe.controller';
import { DedupeRepository } from './dedupe.repository';
import { DuplicateService } from './dedupe.service';
import { DuplicateCheckAdapter } from './duplicate-check.adapter';

/**
 * M3 Dedupe — FR-020 (duplicate & near-duplicate detection). Depends on the
 * global core modules (DB/UnitOfWork, audit, outbox, auth-core, masking) and
 * the @Global CaptureModule's `LeadService` (sole writer of `leads`, §11.2 —
 * `recomputeDuplicateStatus`).
 *
 * `@Global` because this module BINDS capture's {@link DUPLICATE_CHECK_PORT}
 * seam (replacing the Wave-2 `NoopDuplicateCheckAdapter`): `CaptureService`
 * resolves the token from this module's exports (the Wave-1
 * cross-module-provider learning — a non-global provider would stay invisible
 * to the capture injector; same pattern as FR-030's `ALLOCATION_PORT`). The
 * module graph stays acyclic: dedupe imports nothing from capture at the
 * module level — only the port token/types, constants and `LeadService` (via
 * the global exports) cross the boundary.
 */
@Global()
@Module({
  controllers: [DedupeController],
  providers: [
    DuplicateService,
    DedupeRepository,
    DuplicateCheckAdapter,
    { provide: DUPLICATE_CHECK_PORT, useExisting: DuplicateCheckAdapter },
  ],
  exports: [DuplicateService, DUPLICATE_CHECK_PORT],
})
export class DedupeModule {}
