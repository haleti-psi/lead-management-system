import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import type { ScoringResult } from '@lms/shared';
import type { ScoringPort } from '../capture/ports/scoring.port';
import type { LeadService } from '../capture/lead.service';
import { UnitOfWork } from '../../core/db';
import { ScoringService } from './scoring.service';

/**
 * FR-011 — Real adapter for the {@link ScoringPort} seam built by FR-010.
 * Registered in `AllocationModule` and exported so `CaptureModule` can bind it.
 *
 * Invoked by `CaptureService.createLead` as an AWAITED post-commit hook
 * (step 5i). The adapter opens its OWN `UnitOfWork` transaction (the original
 * capture tx is already committed by this point), evaluates the score, and
 * writes it back via `LeadService.setScore` — the sole writer of `leads`.
 *
 * Returns the scoring result so callers can include it in the response DTO.
 * On ANY error it returns `{ score: null, reasons: null }` and logs a structured
 * warn — it NEVER throws. Scoring failure must not block the capture response.
 */
@Injectable()
export class ScoringAdapter implements ScoringPort {
  constructor(
    private readonly scoring: ScoringService,
    private readonly uow: UnitOfWork,
    private readonly leads: LeadService,
    @InjectPinoLogger(ScoringAdapter.name) private readonly logger: PinoLogger,
  ) {}

  async evaluateAsync(leadId: string): Promise<ScoringResult> {
    try {
      let result: ScoringResult = { score: null, reasons: null };
      await this.uow.run(async (tx) => {
        // Load org_id from the same transaction for correct context passing.
        const lead = await tx
          .selectFrom('leads')
          .select(['org_id'])
          .where('lead_id', '=', leadId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();

        if (lead == null) {
          this.logger.warn({ lead_id: leadId, module: 'scoring' }, 'Lead not found for scoring — skipping');
          return;
        }

        result = await this.scoring.evaluate(leadId, tx, lead.org_id);
        await this.leads.setScore(leadId, result.score, result.reasons, tx);
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
