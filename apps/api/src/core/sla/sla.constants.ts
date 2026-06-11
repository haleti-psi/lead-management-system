import { LeadStage } from '@lms/shared';

/**
 * FR-104 — SLA engine runtime constants (fixed; not env vars — the BRD states no
 * requirement to make these configurable, mirroring the outbox-constants rule).
 */

/** A lead is "approaching" breach when due within this many minutes (LLD §Sweep). */
export const APPROACHING_WINDOW_MINUTES = 30;

/**
 * Max rows a single sweep pass selects (NFR-17 LIMIT guard). A run that fills the
 * batch is re-driven by the next scheduled tick; idempotency keeps that safe.
 */
export const SWEEP_BATCH_LIMIT = 100;

/**
 * Lead stages excluded from SLA first-contact scans: terminal or already-past
 * first-contact. A lead in any of these is never selected as approaching/breached.
 */
export const SWEEP_EXCLUDED_STAGES: readonly LeadStage[] = [
  LeadStage.CONTACTED,
  LeadStage.REJECTED,
  LeadStage.HANDED_OFF,
  LeadStage.DORMANT,
];
