import { z } from 'zod';

import { RejectionPrimary } from '@lms/shared';

import { atLeastOneKey } from './common';

const PRIMARY_VALUES = Object.values(RejectionPrimary) as [RejectionPrimary, ...RejectionPrimary[]];

/**
 * FR-131 — `rejection_reasons` master (schema 3.13). `primary_reason` is a
 * `rejection_primary` enum value; `sub_reason` ≤80; `requires_remarks` defaults
 * false. Org-global (no `branch_id`) → only scope-A actors may write.
 */
export const CreateRejectionReasonDto = z.object({
  primaryReason: z.enum(PRIMARY_VALUES, {
    errorMap: () => ({ message: 'primaryReason must be a valid rejection primary reason.' }),
  }),
  subReason: z.string().max(80, 'subReason must not exceed 80 characters.').optional(),
  requiresRemarks: z
    .boolean({ invalid_type_error: 'requiresRemarks must be a boolean.' })
    .optional(),
});
export type CreateRejectionReasonDto = z.infer<typeof CreateRejectionReasonDto>;

export const PatchRejectionReasonDto = atLeastOneKey(
  CreateRejectionReasonDto.partial().extend({ isActive: z.boolean().optional() }),
);
export type PatchRejectionReasonDto = z.infer<typeof PatchRejectionReasonDto>;
