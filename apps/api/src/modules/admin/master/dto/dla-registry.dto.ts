import { z } from 'zod';

import { DlaType } from '@lms/shared';

import { atLeastOneKey } from './common';

const TYPE_VALUES = Object.values(DlaType) as [DlaType, ...DlaType[]];

/**
 * FR-131 — `dla_registry` master (schema 3.17, Digital Lending App registry).
 * `type` is a `dla_type` enum value; JSONB fields hold structured detail.
 * `status` follows `config_status` and defaults `active`.
 */
export const CreateDlaRegistryDto = z.object({
  name: z
    .string({ required_error: 'name is required.' })
    .min(1, 'name is required.')
    .max(150, 'name must not exceed 150 characters.'),
  type: z.enum(TYPE_VALUES, { errorMap: () => ({ message: 'type must be a valid DLA type.' }) }),
  owner: z.string().max(120, 'owner must not exceed 120 characters.').optional(),
  url: z.string().url('url must be a valid URL.').max(255).optional(),
  grievanceOfficer: z.record(z.unknown()).optional(),
  enabledProducts: z.array(z.string()).optional(),
  dataCollected: z.record(z.unknown()).optional(),
  storageLocation: z.string().max(120).optional(),
});
export type CreateDlaRegistryDto = z.infer<typeof CreateDlaRegistryDto>;

export const PatchDlaRegistryDto = atLeastOneKey(
  CreateDlaRegistryDto.partial().extend({
    status: z
      .enum(['draft', 'active', 'retired'], {
        errorMap: () => ({ message: 'status must be draft, active, or retired.' }),
      })
      .optional(),
  }),
);
export type PatchDlaRegistryDto = z.infer<typeof PatchDlaRegistryDto>;
