import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

/**
 * FR-010 → FR-011 dependency seam. Post-commit, non-blocking score evaluation
 * (FR-010 step 5i). `ScoringService` (M4, FR-011) is not built yet; it will
 * rebind {@link SCORING_PORT} and write the score back through
 * `LeadService.setScore`. Until then the no-op adapter logs the skip.
 */
export interface ScoringPort {
  /** Fire-and-forget score evaluation for a freshly committed lead. */
  evaluateAsync(leadId: string): Promise<void>;
}

/** DI token for {@link ScoringPort} (bound in `capture.module.ts`). */
export const SCORING_PORT = Symbol('SCORING_PORT');

/** Placeholder adapter until FR-011 lands — logged no-op (scores stay null). */
@Injectable()
export class NoopScoringAdapter implements ScoringPort {
  constructor(@InjectPinoLogger(NoopScoringAdapter.name) private readonly logger: PinoLogger) {}

  evaluateAsync(leadId: string): Promise<void> {
    this.logger.debug({ lead_id: leadId }, 'Scoring skipped (FR-011 not yet built)');
    return Promise.resolve();
  }
}
