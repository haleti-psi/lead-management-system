import { z } from 'zod';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';

/**
 * FR-132 — `GET /admin/config` query schema. Standard pagination (page ≥ 1
 * default 1; limit 1..100 default 25 — NFR-17; the server ALWAYS applies a
 * LIMIT) plus an optional `config_type` filter that narrows the pending queue to
 * one configuration kind. Query-string values arrive as strings, hence `coerce`
 * on the numeric fields. Validated at the controller boundary by
 * {@link ZodValidationPipe}; any failure becomes `VALIDATION_ERROR` (400).
 */
export const ListConfigVersionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  config_type: z.string().min(1).max(100).optional(),
});

export type ListConfigVersionsQuery = z.infer<typeof ListConfigVersionsQuery>;
