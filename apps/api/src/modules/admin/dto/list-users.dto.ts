import { z } from 'zod';

import { UserStatus } from '@lms/shared';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';

/**
 * FR-130 — `GET /admin/users` query schema (LLD §1). Pagination mirrors the
 * standard `PaginationParams` (page ≥ 1 default 1; limit 1..100 default 25 — the
 * server ALWAYS applies a LIMIT). `sort` accepts a `+`/`-` prefix over an
 * allow-listed column; anything else falls back to `-created_at` in the
 * repository. Filters arrive as Express `qs` nested keys (`filter[status]=…`),
 * so they are parsed from a nested `filter` object. Query values are strings,
 * hence `coerce` on the numeric fields.
 */
const SORTABLE = ['created_at', 'full_name', 'username'] as const;

export const ListUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  sort: z
    .string()
    .regex(/^[+-]?(created_at|full_name|username)$/, 'sort must be a +/- prefixed allowed column.')
    .optional(),
  filter: z
    .object({
      status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.LOCKED]).optional(),
      role_id: z.string().uuid().optional(),
      branch_id: z.string().uuid().optional(),
      team_id: z.string().uuid().optional(),
    })
    .optional(),
});

export type ListUsersQuery = z.infer<typeof ListUsersQuery>;

/** The allow-listed sortable columns (exported for the repository). */
export const USER_SORT_COLUMNS = SORTABLE;
export type UserSortColumn = (typeof SORTABLE)[number];

export { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT };
