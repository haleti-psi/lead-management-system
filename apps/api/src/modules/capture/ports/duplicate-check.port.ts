import type { MatchConfidence } from '@lms/shared';

import type { DbTransaction } from '../../../core/db';

/**
 * FR-010 → FR-020 dependency seam (Wave-2 cross-FR port, per the Wave-1
 * convention: consumer defines a NARROW port; the owner FR binds the adapter).
 * `DuplicateService` (M3 dedupe, FR-020) is not built yet, so capture depends
 * only on this port. {@link NoopDuplicateCheckAdapter} is bound until FR-020
 * rebinds {@link DUPLICATE_CHECK_PORT} to the real engine.
 */

/** One matched lead as surfaced in `error.detail.matches` (FR-010 LLD §409). */
export interface DuplicateMatchSummary {
  lead_id: string;
  lead_code: string;
  confidence: MatchConfidence;
  matched_on: string[];
}

/** Identity keys the sync pre-check matches on (FR-020 §match rules). */
export interface DuplicateProbeIdentity {
  mobile: string;
  pan_token?: string | null;
  name?: string;
}

/** Result of the pre-commit sync check (FR-010 step 5f). */
export interface DuplicateSyncResult {
  /** True when a strong match with configured action `blocked` was found. */
  blocked: boolean;
  matches: DuplicateMatchSummary[];
}

export interface DuplicateCheckPort {
  /**
   * Synchronous strong-block pre-check, run INSIDE the capture transaction
   * (FR-010 §Step F). `blocked=true` aborts the capture with
   * `CONFLICT/DUPLICATE_BLOCKED` and rolls the transaction back.
   */
  matchSync(
    identity: DuplicateProbeIdentity,
    orgId: string,
    tx: DbTransaction,
  ): Promise<DuplicateSyncResult>;

  /**
   * Post-commit async medium/weak scan (FR-010 step 5j). Never throws into the
   * caller's response path.
   */
  matchAsync(leadId: string): Promise<void>;
}

/** DI token for {@link DuplicateCheckPort} (bound in `capture.module.ts`). */
export const DUPLICATE_CHECK_PORT = Symbol('DUPLICATE_CHECK_PORT');
