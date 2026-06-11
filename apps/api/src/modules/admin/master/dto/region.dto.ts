import { z } from 'zod';

import { atLeastOneKey } from './common';

/**
 * FR-131 — `regions` master (schema 3.1). Columns: `code` (≤20, unique per org),
 * `name` (≤80). `regions` has no `is_active` column, so it cannot be deactivated.
 */
export const CreateRegionDto = z.object({
  code: z
    .string({ required_error: 'code is required.' })
    .min(1, 'code is required.')
    .max(20, 'code must not exceed 20 characters.'),
  name: z
    .string({ required_error: 'name is required.' })
    .min(1, 'name is required.')
    .max(80, 'name must not exceed 80 characters.'),
});
export type CreateRegionDto = z.infer<typeof CreateRegionDto>;

export const PatchRegionDto = atLeastOneKey(CreateRegionDto.partial());
export type PatchRegionDto = z.infer<typeof PatchRegionDto>;
