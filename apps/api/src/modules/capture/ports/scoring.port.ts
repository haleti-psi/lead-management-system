import type { ScoringResult } from '@lms/shared';

/**
 * FR-010 → FR-011 dependency seam. Post-commit, awaited score evaluation
 * (FR-010 step 5i). `ScoringService` (M4, FR-011) binds {@link SCORING_PORT}
 * and writes the score back through `LeadService.setScore` before returning
 * the result so callers can include it in the response DTO.
 */
export interface ScoringPort {
  /** Evaluate and persist the score for a freshly committed lead. Returns the
   *  scoring result (score + reasons) on success, or { score: null, reasons: null }
   *  on any error — never throws. */
  evaluateAsync(leadId: string): Promise<ScoringResult>;
}

/** DI token for {@link ScoringPort} (bound in `capture.module.ts`). */
export const SCORING_PORT = Symbol('SCORING_PORT');
