import type { GrantStatus } from '@lms/shared';

/**
 * FR-003 break-glass view/wire types — the web mirror of the backend DTOs in
 * `apps/api/src/modules/identity/break-glass.dto.ts`. Field names and casing match
 * the API verbatim (camelCase on the wire); do not diverge.
 */

/** The grant scope kinds (`break-glass.dto.ts` BREAK_GLASS_SCOPE_TYPES). */
export type BreakGlassScopeType = 'lead' | 'branch' | 'all';

export const BREAK_GLASS_SCOPE_TYPES: readonly BreakGlassScopeType[] = ['lead', 'branch', 'all'];

/**
 * One row of `GET /admin/break-glass` (`BreakGlassGrantListItem`). `makerId` is the
 * requester; `granteeId` the user the grant is for; `approverId` the nominated
 * four-eyes approver.
 */
export interface BreakGlassGrantListItem {
  grantId: string;
  granteeId: string;
  makerId: string;
  approverId: string;
  scopeType: BreakGlassScopeType;
  scopeRef: string | null;
  status: GrantStatus;
  reason: string;
  validFrom: string;
  validUntil: string;
}

/**
 * Request body for `POST /admin/break-glass` (`BreakGlassRequestDto`). `validFrom`
 * / `validUntil` are ISO-8601 datetimes; the window must be within the server's
 * configured maximum (the server re-validates and rejects with VALIDATION_ERROR).
 */
export interface BreakGlassRequestBody {
  granteeId: string;
  approverId: string;
  scopeType: BreakGlassScopeType;
  scopeRef?: string | null;
  reason: string;
  validFrom: string;
  validUntil: string;
}

/** Response of `POST /admin/break-glass/{id}/approve` and `/revoke`
 * (`BreakGlassTransitionResponse`). */
export interface BreakGlassTransitionResult {
  grantId: string;
  status: GrantStatus;
  approverId: string;
  updatedAt: string;
}
