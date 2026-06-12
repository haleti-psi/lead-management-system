import { z } from 'zod';

import { ConsentPurpose, ConsentState } from '@lms/shared';

import { PaginationParams } from '../../../core/common';

/**
 * FR-110 — query params for `GET /api/v1/leads/{id}/consents`: standard
 * pagination (page ≥ 1, limit 1..100 default 25) plus the optional
 * purpose/state filters (LLD §Endpoint 1).
 */
export const ListConsentsQuery = PaginationParams.extend({
  purpose: z
    .nativeEnum(ConsentPurpose, {
      errorMap: () => ({ message: 'purpose must be one of the allowed consent purposes.' }),
    })
    .optional(),
  state: z
    .nativeEnum(ConsentState, {
      errorMap: () => ({ message: 'state must be a valid consent state.' }),
    })
    .optional(),
});
export type ListConsentsQuery = z.infer<typeof ListConsentsQuery>;
