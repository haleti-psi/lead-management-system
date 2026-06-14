import { z } from 'zod';

import { DlaType, ConfigStatus, ProductCode } from '@lms/shared';

/**
 * FR-113 — Grievance officer sub-schema used in both create and update DTOs.
 */
export const GrievanceOfficerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email('grievance_officer.email must be a valid email address'),
  phone: z.string().min(1, 'grievance_officer.phone is required'),
});

export type GrievanceOfficerDto = z.infer<typeof GrievanceOfficerSchema>;

/**
 * FR-113 — `POST /compliance/dla` request body (LLD §Validation `CreateDlaDto`).
 * Zod schema; validated by {@link ZodValidationPipe} at the controller boundary.
 *
 * Notes:
 * - `status` defaults to 'draft'; cannot be 'retired' on create.
 * - Mandatory disclosure fields (owner, url, grievance_officer, storage_location)
 *   are validated in the service layer (not Zod) because the constraint depends on
 *   the final `status` value.
 */
export const CreateDlaDto = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .max(150, 'name must not exceed 150 characters'),

  type: z.nativeEnum(DlaType, {
    errorMap: () => ({ message: "type must be one of 'dla', 'lsp', 'partner'" }),
  }),

  owner: z.string().max(120).nullable().optional(),

  url: z
    .string()
    .url('url must be a valid URL')
    .max(255)
    .nullable()
    .optional(),

  grievance_officer: GrievanceOfficerSchema.nullable().optional(),

  enabled_products: z
    .array(z.nativeEnum(ProductCode))
    .nullable()
    .optional(),

  data_collected: z
    .array(z.string().min(1))
    .max(50, 'data_collected must not exceed 50 items')
    .nullable()
    .optional(),

  storage_location: z.string().max(120).nullable().optional(),

  // Only draft | active allowed on create; cannot create as retired
  status: z
    .enum([ConfigStatus.DRAFT, ConfigStatus.ACTIVE])
    .optional()
    .default(ConfigStatus.DRAFT),
});

export type CreateDlaDto = z.infer<typeof CreateDlaDto>;
