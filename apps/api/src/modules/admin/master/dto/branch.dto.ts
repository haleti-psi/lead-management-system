import { z } from 'zod';

import { atLeastOneKey, pinCode } from './common';

/**
 * FR-131 — `branches` master (schema 3.3). `region_id` must reference an EXISTING
 * ACTIVE region in the same org (FK check performed in the service → VALIDATION_ERROR
 * field `regionId` when absent). `pin_codes` is a JSONB array of 6-digit strings.
 */
export const CreateBranchDto = z.object({
  code: z
    .string({ required_error: 'code is required.' })
    .min(1, 'code is required.')
    .max(20, 'code must not exceed 20 characters.'),
  name: z
    .string({ required_error: 'name is required.' })
    .min(1, 'name is required.')
    .max(120, 'name must not exceed 120 characters.'),
  regionId: z
    .string({ required_error: 'regionId must reference an active region.' })
    .uuid('regionId must reference an active region.'),
  pinCodes: z.array(pinCode).optional(),
  address: z.string().max(255, 'address must not exceed 255 characters.').optional(),
});
export type CreateBranchDto = z.infer<typeof CreateBranchDto>;

export const PatchBranchDto = atLeastOneKey(
  CreateBranchDto.partial().extend({ isActive: z.boolean().optional() }),
);
export type PatchBranchDto = z.infer<typeof PatchBranchDto>;
