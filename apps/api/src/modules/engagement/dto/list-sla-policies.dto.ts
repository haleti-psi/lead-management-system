import { z } from 'zod';

import { SlaTarget } from '@lms/shared';

import { MAX_PAGE_LIMIT } from '../../../core/common';

/**
 * FR-104 — `GET /admin/sla-policies` query schema (LLD §Validation Logic). Reuses
 * the standard pagination bounds (page ≥ 1 default 1; limit 1..100 default 25 —
 * NFR-17) plus optional `applies_to` / `is_active` filters. Query-string values
 * arrive as strings, so numeric/boolean fields are coerced.
 */

const SLA_TARGET_VALUES = Object.values(SlaTarget) as [SlaTarget, ...SlaTarget[]];

export const ListSlaPoliciesQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(25),
  applies_to: z.enum(SLA_TARGET_VALUES).optional(),
  // Accept the usual truthy/falsey query encodings ("true"/"false"/"1"/"0").
  is_active: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .optional(),
});

export type ListSlaPoliciesQueryDto = z.infer<typeof ListSlaPoliciesQueryDto>;
