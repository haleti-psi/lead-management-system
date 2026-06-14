import { Global, Module } from '@nestjs/common';

import { ALLOCATION_PORT } from '../capture/ports/allocation.port';
import { SCORING_PORT } from '../capture/ports/scoring.port';
import { AllocationController } from './allocation.controller';
import { AllocationRuleRepository } from './allocation-rule.repository';
import { AllocationService } from './allocation.service';
import { ScoringAdapter } from './scoring.adapter';
import { ScoringRepository } from './scoring.repository';
import { ScoringService } from './scoring.service';

/**
 * M4 Allocation — FR-030 (rules-based allocation + manual reassign +
 * `allocation_rules` administration) + FR-011 (lead quality scoring).
 * Depends on the global core modules (DB/UnitOfWork, auth-core, sla) and the
 * @Global CaptureModule's `LeadService` (sole writer of `leads`, §11.2).
 *
 * `@Global` because this module BINDS capture's {@link ALLOCATION_PORT} and
 * {@link SCORING_PORT} seams. Both tokens are resolved by `CaptureService` from
 * this module's exports (the Wave-1 cross-module-provider learning — a non-global
 * provider would stay invisible to the capture injector). The module graph stays
 * acyclic: allocation imports nothing from capture at the module level; only the
 * port token/types and `LeadService` (via the global exports) cross the boundary.
 *
 * FR-011 + FR-031 wiring: AllocationModule provides {@link ScoringService} +
 * {@link ScoringRepository} + {@link ScoringAdapter} and rebinds the
 * {@link SCORING_PORT} token that `CaptureModule` registered as a no-op. Because
 * `AllocationModule` is `@Global` the binding is visible org-wide.
 * FR-031 extends `ScoringAdapter.evaluateAsync` to also call
 * `evaluateHotRules` and `LeadService.setHotFlag` (+ HOT_LEAD outbox on
 * false→true transition). `OutboxService` is injected from the global
 * `OutboxModule`.
 */
@Global()
@Module({
  controllers: [AllocationController],
  providers: [
    AllocationService,
    AllocationRuleRepository,
    { provide: ALLOCATION_PORT, useExisting: AllocationService },
    // FR-011 scoring
    ScoringRepository,
    ScoringService,
    ScoringAdapter,
    { provide: SCORING_PORT, useExisting: ScoringAdapter },
  ],
  exports: [AllocationService, ALLOCATION_PORT, ScoringService, ScoringAdapter, SCORING_PORT],
})
export class AllocationModule {}
