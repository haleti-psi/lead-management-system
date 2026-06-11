import { z } from 'zod';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';

/**
 * FR-130 — `GET /admin/teams` query schema (LLD §6). Standard pagination plus
 * optional `filter[branch_id]` / `filter[is_active]` (Express `qs` nested keys).
 * `is_active` arrives as the string `'true'`/`'false'`, so it is coerced from a
 * string enum to a boolean.
 */
export const ListTeamsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  filter: z
    .object({
      branch_id: z.string().uuid().optional(),
      is_active: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    })
    .optional(),
});

export type ListTeamsQuery = z.infer<typeof ListTeamsQuery>;
