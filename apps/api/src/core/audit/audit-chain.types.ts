/**
 * The columns the chain consumer and the integrity verifier read from
 * `audit_logs`. A superset of {@link CanonicalAuditRow} plus the stored chain
 * columns, so the verifier can compare the recomputed hash against the sealed
 * value and follow `prev_audit_hash` continuity.
 */
export interface ChainRow {
  audit_id: string;
  org_id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  detail: unknown;
  created_at: Date | string;
  prev_audit_hash: string | null;
  after_hash: string | null;
}

/** Outcome of sealing a batch of pending (unsealed) rows. */
export interface SealResult {
  /** Rows sealed in this run (had a null `after_hash`, now chained). */
  readonly sealed: number;
  /** The chain tip (`after_hash` of the last sealed row) after the run, if any. */
  readonly tipHash: string | null;
}

/** Why the verifier judged a contiguous window broken. */
export type IntegrityBreakKind =
  /** A row's `prev_audit_hash` does not equal the previous row's `after_hash`. */
  | 'chain_gap'
  /** A row's stored `after_hash` does not match the recomputed digest (tamper). */
  | 'hash_mismatch'
  /** A row that should be sealed has a null `after_hash` (unsealed within window). */
  | 'unsealed';

/** The result of verifying a contiguous, oldest-first window of audit rows. */
export interface IntegrityResult {
  /** True when every consecutive pair chains and every hash recomputes. */
  readonly intact: boolean;
  /** Number of rows examined (0 or 1 → nothing to chain-verify). */
  readonly checkedCount: number;
  /** The `audit_id` of the first row where a break was detected, else null. */
  readonly breakAt: string | null;
  /** The kind of break detected, else null. */
  readonly breakKind: IntegrityBreakKind | null;
}
