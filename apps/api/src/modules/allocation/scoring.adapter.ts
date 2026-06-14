import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { EventCode, type HotReasonCode, type ScoringResult } from '@lms/shared';
import type { ScoringPort } from '../capture/ports/scoring.port';
import type { LeadService } from '../capture/lead.service';
import { UnitOfWork } from '../../core/db';
import { OutboxService } from '../../core/outbox';
import { ScoringService } from './scoring.service';
import { ScoringRepository } from './scoring.repository';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';

/**
 * FR-011 + FR-031 — Real adapter for the {@link ScoringPort} seam built by FR-010.
 * Registered in `AllocationModule` and exported so `CaptureModule` can bind it.
 *
 * Invoked by `CaptureService.createLead` as an AWAITED post-commit hook
 * (step 5i). The adapter opens its OWN `UnitOfWork` transaction (the original
 * capture tx is already committed by this point), evaluates the FR-011 quality
 * score AND the FR-031 hot rules, then writes both back via `LeadService` —
 * the sole writer of `leads`.
 *
 * FR-031 integration:
 * - After `setScore`, calls `evaluateHotRules(context)` using the already-loaded
 *   context so we pay for the DB reads only once.
 * - Calls `LeadService.setHotFlag` to persist the is_hot flag.
 * - Emits a `HOT_LEAD` outbox event ONLY on a false→true transition
 *   (context.is_hot was false and isHot is now true).
 * - On cool-down (isHot=false) calls setHotFlag(false, ['COOLED']) — no event.
 * - On already-hot re-confirm (isHot=true, was already true) calls setHotFlag
 *   to refresh reasons but does NOT re-emit the event (idempotent).
 *
 * Returns the FR-011 scoring result so callers can include it in the response DTO.
 * On ANY error it returns `{ score: null, reasons: null }` and logs a structured
 * warn — it NEVER throws. Scoring failure must not block the capture response.
 */
@Injectable()
export class ScoringAdapter implements ScoringPort {
  constructor(
    private readonly scoring: ScoringService,
    private readonly repo: ScoringRepository,
    private readonly uow: UnitOfWork,
    private readonly leads: LeadService,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(ScoringAdapter.name) private readonly logger: PinoLogger,
  ) {}

  async evaluateAsync(leadId: string): Promise<ScoringResult> {
    try {
      let result: ScoringResult = { score: null, reasons: null };
      await this.uow.run(async (tx) => {
        // Load the full scoring context once — used by both FR-011 score and
        // FR-031 hot rules. Includes org_id, priority, is_hot, and hot-rule
        // auxiliary fields (doc count, eligibility snap, callback task).
        const context = await this.repo.loadContext(leadId, tx);

        // FR-011: quality score (unchanged — 13-factor weighted sum).
        // Pass the already-loaded context to avoid a second DB round-trip (fix #3).
        result = await this.scoring.evaluate(leadId, tx, context.org_id, context);
        await this.leads.setScore(leadId, result.score, result.reasons, tx);

        // FR-031: hot-rule evaluation (H1–H8). Uses the same context — no extra DB reads.
        // evaluateHotRules always returns ≥1 reason (firing reasons when hot, ['COOLED']
        // when not) so hotReasons is never empty — no self-healing branch needed.
        const { isHot, hotReasons }: { isHot: boolean; hotReasons: HotReasonCode[] } =
          this.scoring.evaluateHotRules(context);

        await this.leads.setHotFlag(leadId, isHot, hotReasons, tx);

        // HOT_LEAD outbox event ONLY on false→true transition (LLD §Step 11).
        if (isHot && !context.is_hot) {
          await this.outbox.emit(
            {
              event_code: EventCode.HOT_LEAD,
              aggregate_type: LEADS_RESOURCE_TYPE,
              aggregate_id: leadId,
              payload: {
                lead_id: leadId,
                score: result.score,
                reasons: hotReasons,
                triggered_by: 'scoring',
              },
            },
            tx,
          );
        }
      });
      return result;
    } catch (err) {
      this.logger.warn(
        { err, lead_id: leadId, module: 'scoring' },
        'ScoringAdapter.evaluateAsync failed — score stays null',
      );
      // Do not rethrow — scoring failure must not block the capture response.
      return { score: null, reasons: null };
    }
  }
}
