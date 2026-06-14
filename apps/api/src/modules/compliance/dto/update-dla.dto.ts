import { z } from 'zod';

import { DlaType, ConfigStatus, ProductCode } from '@lms/shared';

import { GrievanceOfficerSchema } from './create-dla.dto';

/**
 * FR-113 — `PATCH /compliance/dla` request body (LLD §Validation `UpdateDlaDto`).
 *
 * The `dla_registry_id` identifying the record to update is in the body (not the
 * path) per api-contract.yaml (no `{id}` path segment — see LLD Ambiguity #1).
 * At least one field beyond `dla_registry_id` must be supplied.
 */
export const UpdateDlaDto = z
  .object({
    dla_registry_id: z.string().uuid('dla_registry_id must be a valid UUID'),

    name: z.string().min(1).max(150).optional(),

    type: z
      .nativeEnum(DlaType, {
        errorMap: () => ({ message: "type must be one of 'dla', 'lsp', 'partner'" }),
      })
      .optional(),

    owner: z.string().max(120).nullable().optional(),

    url: z.string().url('url must be a valid URL').max(255).nullable().optional(),

    grievance_officer: GrievanceOfficerSchema.nullable().optional(),

    enabled_products: z.array(z.nativeEnum(ProductCode)).nullable().optional(),

    data_collected: z
      .array(z.string().min(1))
      .max(50, 'data_collected must not exceed 50 items')
      .nullable()
      .optional(),

    storage_location: z.string().max(120).nullable().optional(),

    status: z.nativeEnum(ConfigStatus).optional(),
  })
  .refine((d) => Object.keys(d).filter((k) => k !== 'dla_registry_id').length > 0, {
    message: 'At least one field besides dla_registry_id must be provided',
    path: ['_'],
  });

export type UpdateDlaDto = z.infer<typeof UpdateDlaDto>;
