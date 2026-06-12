import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../core/http';
import { DUPLICATE_BLOCKED_REASON, OVERRIDE_ROLES } from './dedupe.constants';
import type { ScoredMatch } from './dedupe.service';

/**
 * FR-020 — strong-block outcome (LLD §Internal invocation / T30). Thrown by
 * `DuplicateService.match()` on the intake gate and by the explicit re-check
 * when the resolved action is `blocked` without an authorised override. A
 * `DomainException` subclass, so the global filter renders the contract 409:
 * `CONFLICT` with `detail.reason = 'DUPLICATE_BLOCKED'`, the match list (key
 * NAMES only — no PII values; error responses bypass the masking interceptor)
 * and `override_allowed_by` (T13). The capture adapter catches it and maps to
 * the frozen `DuplicateCheckPort` result, so FR-010's own 409 flow is unchanged.
 */
export class DuplicateBlockedException extends DomainException {
  readonly matches: readonly ScoredMatch[];

  constructor(matches: readonly ScoredMatch[]) {
    super(ERROR_CODES.CONFLICT, undefined, {
      detail: {
        reason: DUPLICATE_BLOCKED_REASON,
        matches: matches.map((m) => ({
          matched_lead_id: m.matched_lead_id,
          matched_lead_code: m.matched_lead_code,
          confidence: m.confidence,
          matched_on: m.matched_on,
        })),
        override_allowed_by: [...OVERRIDE_ROLES],
      },
    });
    this.name = 'DuplicateBlockedException';
    this.matches = matches;
  }
}
