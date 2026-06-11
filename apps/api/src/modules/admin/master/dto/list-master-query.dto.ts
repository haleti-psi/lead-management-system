import { z } from 'zod';

import { MAX_PAGE_LIMIT } from '../../../../core/common';

/**
 * FR-131 — `GET /admin/{masterResource}` query schema. Standard pagination
 * (page ≥ 1 default 1; limit 1..100 default 25 — NFR-17; T03/T04) plus an
 * optional activeness filter. The contract uses bracket syntax
 * (`filter[is_active]=true`), which Express/qs parses into `{ filter: { is_active } }`;
 * a flat `is_active` is also accepted for convenience. Both arrive as strings.
 */
const boolFromQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const ListMasterQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(25),
    is_active: boolFromQuery.optional(),
    filter: z.object({ is_active: boolFromQuery.optional() }).optional(),
  })
  .transform((q) => ({
    page: q.page,
    limit: q.limit,
    isActive: q.filter?.is_active ?? q.is_active,
  }));

export type ListMasterQuery = z.infer<typeof ListMasterQuery>;
