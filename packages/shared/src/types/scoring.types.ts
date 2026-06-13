import type { ScoreReasonCode } from '../enums/score-reason-code.enum';

/**
 * FR-011 — The result of a scoring evaluation. Both fields are null when scoring
 * fails (best-effort: failure never blocks lead capture/update).
 */
export interface ScoringResult {
  score: number | null;
  reasons: ScoreReasonCode[] | null;
}
