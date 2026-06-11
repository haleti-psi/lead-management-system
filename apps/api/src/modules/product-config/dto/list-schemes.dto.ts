import { z } from 'zod';

import { ProductCode } from '@lms/shared';

import { MAX_PAGE_LIMIT } from '../../../core/common';

/**
 * FR-042 — `GET /admin/schemes` query schema (LLD §1 List). Reuses the standard
 * pagination bounds (page ≥ 1 default 1; limit 1..100 default 25 — the server
 * ALWAYS applies a LIMIT, NFR-17) plus optional `product_code` and `is_active`
 * filters. Query-string values arrive as strings, so numeric/boolean fields are
 * coerced. When `is_active` is omitted, schemes of every status are returned
 * (LLD §1: "omit to return all").
 */

const PRODUCT_CODE_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];

export const ListSchemesQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(25),
  product_code: z.enum(PRODUCT_CODE_VALUES).optional(),
  // Accept the usual truthy/falsey query encodings ("true"/"false"/"1"/"0").
  is_active: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .optional(),
});

export type ListSchemesQueryDto = z.infer<typeof ListSchemesQueryDto>;
