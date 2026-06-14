import { ERROR_CODES, RightsStatus } from '@lms/shared';

import { DomainException } from '../../core/http';

/**
 * Valid forward transitions for each `rights_status`
 * (LLD §State Machine / state-machines.md §DataRightsRequest).
 *
 * Terminal states (`fulfilled`, `rejected_retained`) have empty arrays —
 * any attempted transition throws CONFLICT.
 *
 * The backward transition `in_review → open` is also explicitly excluded.
 */
const ALLOWED: Partial<Record<RightsStatus, RightsStatus[]>> = {
  [RightsStatus.OPEN]: [RightsStatus.IN_REVIEW, RightsStatus.REJECTED_RETAINED],
  [RightsStatus.IN_REVIEW]: [RightsStatus.FULFILLED, RightsStatus.REJECTED_RETAINED],
  [RightsStatus.FULFILLED]: [],
  [RightsStatus.REJECTED_RETAINED]: [],
} as const;

/**
 * FR-112 — Tiny state-machine helper for DataRightsRequest.rights_status.
 *
 * Throws {@link DomainException} (CONFLICT 409) on any invalid transition.
 * Exported as a plain class so it is independently unit-testable (T23/T24/T25).
 */
export class DataRightsStateMachine {
  /**
   * Assert that transitioning from `current` to `target` is valid.
   *
   * @throws {DomainException} CONFLICT (409) when the transition is not allowed.
   */
  static validateTransition(current: RightsStatus, target: RightsStatus): void {
    const allowed = ALLOWED[current];
    if (!allowed || !allowed.includes(target)) {
      throw new DomainException(
        ERROR_CODES.CONFLICT,
        `Invalid status transition from '${current}' to '${target}'.`,
      );
    }
  }
}
