import { z } from 'zod';

import { GrantStatus } from '@lms/shared';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../core/common';

/**
 * Zod DTOs for the FR-003 break-glass endpoints (LLD §Validation Logic).
 * Validation runs at the controller boundary via {@link ZodValidationPipe};
 * every failure becomes `VALIDATION_ERROR` (400) with field-level issues.
 *
 * The request schema is built by {@link makeBreakGlassRequestSchema} so the
 * `superRefine` window cap can close over the runtime
 * `BREAK_GLASS_MAX_WINDOW_HOURS` value (read from {@link AppConfigService}); the
 * shape itself is fixed. The structural cross-field rules (window order,
 * four-eyes, conditional scopeRef) live here so a malformed request is rejected
 * before the service runs any DB pre-check.
 */

const MILLIS_PER_HOUR = 1000 * 60 * 60;

export const BREAK_GLASS_SCOPE_TYPES = ['lead', 'branch', 'all'] as const;
export type BreakGlassScopeType = (typeof BREAK_GLASS_SCOPE_TYPES)[number];

/** Object shape shared by every variant of the request schema. */
const baseShape = {
  granteeId: z.string().uuid({ message: 'granteeId must be a valid UUID' }),
  approverId: z.string().uuid({ message: 'approverId must be a valid UUID' }),
  scopeType: z.enum(BREAK_GLASS_SCOPE_TYPES, {
    message: 'scopeType must be lead, branch, or all',
  }),
  scopeRef: z.string().uuid({ message: 'scopeRef must be a valid UUID' }).nullish(),
  reason: z
    .string({ required_error: 'reason is required' })
    .min(1, 'reason is required')
    .max(500, 'reason must be 500 characters or fewer'),
  validFrom: z.string().datetime({ message: 'validFrom must be a valid ISO-8601 datetime' }),
  validUntil: z.string().datetime({ message: 'validUntil must be a valid ISO-8601 datetime' }),
} as const;

/**
 * Build the request schema bound to the configured maximum access window. The
 * cross-field rules:
 *  - `validUntil` must be strictly after `validFrom`;
 *  - the window must not exceed `maxWindowHours`;
 *  - `approverId` must differ from `granteeId` (four-eyes — also enforced at the
 *    service layer and by the DB `ck_break_glass_four_eyes` constraint);
 *  - `scopeRef` is required when `scopeType` is `lead` or `branch`.
 */
export function makeBreakGlassRequestSchema(maxWindowHours: number) {
  return z.object(baseShape).superRefine((val, ctx) => {
    const from = new Date(val.validFrom).getTime();
    const until = new Date(val.validUntil).getTime();

    if (until <= from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: 'validUntil must be after validFrom',
      });
    } else if ((until - from) / MILLIS_PER_HOUR > maxWindowHours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: `Access window must not exceed ${maxWindowHours} hours`,
      });
    }

    if (val.approverId === val.granteeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approverId'],
        message: 'Approver must be different from grantee (four-eyes required)',
      });
    }

    if (val.scopeType !== 'all' && (val.scopeRef === undefined || val.scopeRef === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopeRef'],
        message: 'scopeRef is required when scopeType is lead or branch',
      });
    }
  });
}

/** The validated request payload (identical for every `maxWindowHours`). */
export type BreakGlassRequestDto = z.infer<ReturnType<typeof makeBreakGlassRequestSchema>>;

/** Response body for `POST /admin/break-glass` (201) — LLD §Endpoints. */
export interface BreakGlassGrantResponse {
  grantId: string;
  granteeId: string;
  approverId: string;
  scopeType: BreakGlassScopeType;
  scopeRef: string | null;
  reason: string;
  status: GrantStatus;
  validFrom: string;
  validUntil: string;
  createdAt: string;
}

/** Response body for the approve/revoke transitions (200) — LLD §Endpoints. */
export interface BreakGlassTransitionResponse {
  grantId: string;
  status: GrantStatus;
  approverId: string;
  updatedAt: string;
}

/**
 * `GET /admin/break-glass` query schema. Standard pagination (page ≥ 1 default 1;
 * limit 1..100 default 25 — the server ALWAYS applies a LIMIT) plus an optional
 * `status` filter over the `grant_status` enum (pending/active/expired/revoked).
 * Query-string values arrive as strings, hence `coerce` on the numeric fields.
 * Validated at the controller boundary by {@link ZodValidationPipe}; any failure
 * becomes `VALIDATION_ERROR` (400).
 */
export const ListBreakGlassQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  status: z
    .enum([GrantStatus.PENDING, GrantStatus.ACTIVE, GrantStatus.EXPIRED, GrantStatus.REVOKED], {
      message: 'status must be pending, active, expired, or revoked',
    })
    .optional(),
});

export type ListBreakGlassQuery = z.infer<typeof ListBreakGlassQuery>;

/** One grant in the `GET /admin/break-glass` listing (`maker` = the requester). */
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
