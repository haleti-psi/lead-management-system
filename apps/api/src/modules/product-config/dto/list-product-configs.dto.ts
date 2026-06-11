import { z } from 'zod';

import { ConfigStatus, ProductCode } from '@lms/shared';

import { PaginationParams } from '../../../core/common';

/**
 * FR-040 — `GET /admin/products` query schema (LLD §1 List). Extends the shared
 * {@link PaginationParams} (page ≥ 1 default 1; limit 1..100 default 25 — the
 * server always applies a LIMIT, NFR-17). Filter keys are bracketed exactly as the
 * api-contract spells them (`filter[status]`, `filter[product_code]`) and arrive
 * as flat query keys; all are optional. `sort` is an allow-list of signed tokens
 * (a leading `-` is descending), rejecting SQL-shaped input. Mirrors FR-140's
 * integration-monitor query convention.
 */

const CONFIG_STATUS_VALUES = Object.values(ConfigStatus) as [ConfigStatus, ...ConfigStatus[]];
const PRODUCT_CODE_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];

/** Allowed sort tokens (LLD §1: created_at, version, name; default -created_at). */
export const PRODUCT_CONFIG_SORTS = [
  '-created_at',
  'created_at',
  '-version',
  'version',
  '-name',
  'name',
] as const;
export type ProductConfigSort = (typeof PRODUCT_CONFIG_SORTS)[number];

export const ListProductConfigsQueryDto = PaginationParams.extend({
  'filter[status]': z.enum(CONFIG_STATUS_VALUES).optional(),
  'filter[product_code]': z.enum(PRODUCT_CODE_VALUES).optional(),
  sort: z.enum(PRODUCT_CONFIG_SORTS).default('-created_at'),
});

export type ListProductConfigsQueryDto = z.infer<typeof ListProductConfigsQueryDto>;

/** Allow-listed sort column (no `-`) — safe to pass to Kysely `.orderBy()`. */
export type SortableColumn = 'created_at' | 'version' | 'name';

/** Normalised list params the service/repository consume (no brackets). */
export interface ProductConfigListParams {
  status?: ConfigStatus;
  product_code?: ProductCode;
  sort: SortableColumn;
  direction: 'asc' | 'desc';
}

/** Map the bracketed/signed query DTO to the internal list-params shape. */
export function toListParams(query: ListProductConfigsQueryDto): ProductConfigListParams {
  const direction: 'asc' | 'desc' = query.sort.startsWith('-') ? 'desc' : 'asc';
  const column = (query.sort.startsWith('-') ? query.sort.slice(1) : query.sort) as SortableColumn;
  return {
    status: query['filter[status]'],
    product_code: query['filter[product_code]'],
    sort: column,
    direction,
  };
}
