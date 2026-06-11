import { Global, Module } from '@nestjs/common';

import { BusinessCalendarService } from './business-calendar.service';
import { SlaEngine } from './sla-engine';

/**
 * FR-104 — `core/sla` module (ADR-6). Global so any module/timer can inject the
 * single business-time clock ({@link BusinessCalendarService}) and the
 * {@link SlaEngine} without re-importing. Depends on the global DB, outbox, and
 * logging modules already registered in the root module.
 *
 * The engine's writer ports (LEAD/KYC/GRIEVANCE_SLA_WRITER_PORT) and the policy
 * reader (SLA_POLICY_READER_PORT) are bound by the owning modules:
 *   - SLA_POLICY_READER_PORT  → M11 engagement ({@link EngagementModule}).
 *   - LEAD_SLA_WRITER_PORT     → M2 capture (FR-010/030, later).
 *   - KYC/GRIEVANCE writers    → KYC module / M12 (later).
 * They are `@Optional()` injections, so the engine constructs without them and
 * fails loudly only if a not-yet-wired write path is actually invoked.
 */
@Global()
@Module({
  providers: [BusinessCalendarService, SlaEngine],
  exports: [BusinessCalendarService, SlaEngine],
})
export class SlaModule {}
