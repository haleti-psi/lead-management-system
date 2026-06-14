import { z } from 'zod';

import { RightsStatus, RightsType } from '@lms/shared';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';

/**
 * FR-112 — `GET /data-rights` query parameters (LLD §Endpoint 1).
 * Validated by {@link ZodValidationPipe} at the controller boundary.
 */
export const ListDataRightsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),

  status: z.nativeEnum(RightsStatus).optional(),
  request_type: z.nativeEnum(RightsType).optional(),
  customer_profile_id: z.string().uuid().optional(),
  due_before: z.string().datetime({ offset: true }).optional(),
});

export type ListDataRightsQuery = z.infer<typeof ListDataRightsQuery>;
