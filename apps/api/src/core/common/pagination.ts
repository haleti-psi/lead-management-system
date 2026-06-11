import { z } from 'zod';

/**
 * Standard list pagination (architecture §4 / performance.md): `page` ≥ 1
 * (default 1) and `limit` 1..100 (default 25). The server ALWAYS applies a
 * LIMIT — unbounded list queries are forbidden (NFR-17). Query-string values
 * arrive as strings, so both fields are coerced. `offset` is derived for use in
 * Kysely `.offset()/.limit()`.
 */
export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export const PaginationParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

export type PaginationParams = z.infer<typeof PaginationParams>;

/** Zero-based row offset for the given page/limit. */
export function toOffset(params: PaginationParams): number {
  return (params.page - 1) * params.limit;
}
