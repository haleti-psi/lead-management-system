import { z } from 'zod';

import { AuditAction } from '@lms/shared';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';
import { ENTITY_TYPE_ALLOWLIST } from '../reporting.constants';

/**
 * FR-123 — `GET /api/v1/audit` query schema (LLD §Validation Logic). Validated at
 * the controller boundary by {@link ZodValidationPipe}; failures become
 * `VALIDATION_ERROR` (400) with field-level `fields[]`. Query-string values
 * arrive as strings, so numerics/dates are coerced.
 *
 * `lead_id` is accepted here (UUID-shaped) for DPO; the ADMIN-forbidden rule is a
 * scope decision (403), enforced in the service — not a field validation.
 */

const AUDIT_ACTION_VALUES = Object.values(AuditAction) as [AuditAction, ...AuditAction[]];
const ENTITY_TYPE_VALUES = ENTITY_TYPE_ALLOWLIST as readonly string[];

/** Coerce an ISO string to a Date and reject an unparseable value. */
const isoDate = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
  message: 'must be a valid date.',
});

export const AuditExplorerQueryDto = z
  .object({
    lead_id: z.string().uuid({ message: 'lead_id must be a valid UUID.' }).optional(),
    actor_id: z.string().uuid({ message: 'actor_id must be a valid UUID.' }).optional(),
    action: z
      .enum(AUDIT_ACTION_VALUES, {
        errorMap: () => ({ message: 'Invalid audit_action value.' }),
      })
      .optional(),
    entity_type: z
      .enum(ENTITY_TYPE_VALUES as [string, ...string[]], {
        errorMap: () => ({ message: 'entity_type is not a recognised entity.' }),
      })
      .optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  })
  .superRefine((val, ctx) => {
    if (val.from && val.to && val.from > val.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'from must not be after to.',
      });
    }
  });

export type AuditExplorerQueryDto = z.infer<typeof AuditExplorerQueryDto>;
