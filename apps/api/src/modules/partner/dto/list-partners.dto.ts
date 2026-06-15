import { z } from 'zod';

import { PartnerStatus, PartnerType } from '@lms/shared';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';
import { PARTNER_SORT_COLUMNS, type PartnerSortField } from '../partner.constants';

const STATUS_VALUES = Object.values(PartnerStatus) as [PartnerStatus, ...PartnerStatus[]];
const TYPE_VALUES = Object.values(PartnerType) as [PartnerType, ...PartnerType[]];

type SortDir = 'asc' | 'desc';

/** FR-090 — `GET /partners` query (LLD §GET). `filter[status]`/`filter[type]`,
 * `sort=field:dir`, page/limit (limit clamped to 100). */
export const ListPartnersQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be a positive integer').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be a positive integer')
    .transform((v) => Math.min(v, MAX_PAGE_LIMIT))
    .default(DEFAULT_PAGE_LIMIT),
  sort: z
    .string()
    .default('created_at:desc')
    .transform((value, ctx): { field: PartnerSortField; dir: SortDir } => {
      const [field, dir] = value.split(':');
      const sortField = PARTNER_SORT_COLUMNS.find((f) => f === field);
      if (!sortField || (dir !== 'asc' && dir !== 'desc')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sort field is not allowed' });
        return z.NEVER;
      }
      return { field: sortField, dir };
    }),
  filter: z
    .object({
      status: z.enum(STATUS_VALUES, { errorMap: () => ({ message: 'invalid status value' }) }).optional(),
      type: z.enum(TYPE_VALUES, { errorMap: () => ({ message: 'invalid type value' }) }).optional(),
    })
    .strict()
    .default({}),
});
export type ListPartnersQuery = z.infer<typeof ListPartnersQuerySchema>;
