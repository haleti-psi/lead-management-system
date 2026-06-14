import { z } from 'zod';

import { DlaType, ConfigStatus } from '@lms/shared';

import { PaginationParams } from '../../../core/common';
import { DLA_REGISTRY_ALLOWED_SORT_COLUMNS, DLA_REGISTRY_DEFAULT_SORT } from '../dla-registry.constants';

/**
 * FR-113 — Query parameters for `GET /compliance/dla`.
 * Extends shared pagination with optional type/status filters and a sort column.
 */
export const ListDlaFiltersDto = PaginationParams.extend({
  type: z.nativeEnum(DlaType).optional(),
  status: z.nativeEnum(ConfigStatus).optional(),
  sort: z
    .enum(DLA_REGISTRY_ALLOWED_SORT_COLUMNS)
    .optional()
    .default(DLA_REGISTRY_DEFAULT_SORT),
});

export type ListDlaFiltersDto = z.infer<typeof ListDlaFiltersDto>;
