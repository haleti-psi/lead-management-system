import { RoleCode } from '@lms/shared';

/**
 * FR-020 — M3 dedupe constants. Per AMBIGUITIES.md D4 (decision: thresholds are
 * CONSTANTS, no `DuplicateConfig` table) the BRD default-match table is encoded
 * here / in `dedupe.service.ts` exactly as FR-020.md specifies.
 */

/** Per-key candidate cap (FR-020 LLD §Step 2 — "capped at LIMIT 10"). */
export const PER_KEY_CANDIDATE_LIMIT = 10;

/** Bound for the existing-pair lookup (≤ 5 keys × 10 candidates; LIMIT rule). */
export const EXISTING_PAIR_LIMIT = 100;

/** Roles that may override a strong block (BRD match table / LLD §Auth). */
export const OVERRIDE_ROLES: readonly RoleCode[] = [RoleCode.BM, RoleCode.SM];

/** Roles that may request the `queue` action (LLD §Auth — queue action). */
export const QUEUE_ROLES: readonly RoleCode[] = [RoleCode.BM, RoleCode.SM, RoleCode.KYC];

/** `error.detail.reason` for the 409 strong-block (error-taxonomy.md). */
export const DUPLICATE_BLOCKED_REASON = 'DUPLICATE_BLOCKED';
