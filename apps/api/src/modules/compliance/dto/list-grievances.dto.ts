import { z } from 'zod';

import { GrievanceCategory, GrievanceStatus } from '@lms/shared';

import { MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT } from '../../../core/common';

const ALLOWED_SORT_COLUMNS = ['created_at', 'sla_due_at', 'status'] as const;
type AllowedSortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

/**
 * FR-114 — `GET /grievances` query parameters (LLD §Endpoint 1).
 * Validated by {@link ZodValidationPipe} at the controller boundary.
 */
export const ListGrievancesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  status: z.nativeEnum(GrievanceStatus).optional(),
  category: z.nativeEnum(GrievanceCategory).optional(),
  owner_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  sort: z
    .string()
    .optional()
    .transform((v): { column: AllowedSortColumn; dir: 'asc' | 'desc' } => {
      const raw = v ?? '-created_at';
      const desc = raw.startsWith('-');
      const col = desc ? raw.slice(1) : raw;
      const column = ALLOWED_SORT_COLUMNS.includes(col as AllowedSortColumn)
        ? (col as AllowedSortColumn)
        : 'created_at';
      return { column, dir: desc ? 'desc' : 'asc' };
    }),
});

export type ListGrievancesQuery = z.infer<typeof ListGrievancesQuery>;
