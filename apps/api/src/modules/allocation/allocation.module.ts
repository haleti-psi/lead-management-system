import { Global, Module } from '@nestjs/common';

import { ALLOCATION_PORT } from '../capture/ports/allocation.port';
import { AllocationController } from './allocation.controller';
import { AllocationRuleRepository } from './allocation-rule.repository';
import { AllocationService } from './allocation.service';

/**
 * M4 Allocation — FR-030 (rules-based allocation + manual reassign +
 * `allocation_rules` administration). Depends on the global core modules
 * (DB/UnitOfWork, auth-core, sla) and the @Global CaptureModule's
 * `LeadService` (sole writer of `leads`, §11.2).
 *
 * `@Global` because this module BINDS capture's {@link ALLOCATION_PORT} seam:
 * `CaptureService` resolves the token from this module's exports (the Wave-1
 * cross-module-provider learning — a non-global provider would stay invisible
 * to the capture injector). The module graph stays acyclic: allocation imports
 * nothing from capture at the module level; only the port token/types and
 * `LeadService` (via the global exports) cross the boundary.
 */
@Global()
@Module({
  controllers: [AllocationController],
  providers: [
    AllocationService,
    AllocationRuleRepository,
    { provide: ALLOCATION_PORT, useExisting: AllocationService },
  ],
  exports: [AllocationService, ALLOCATION_PORT],
})
export class AllocationModule {}
