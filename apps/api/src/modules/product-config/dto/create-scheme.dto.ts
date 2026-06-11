import { z } from 'zod';

import { ProductCode } from '@lms/shared';

/**
 * FR-042 — `POST /admin/schemes` request schema (LLD §Validation Logic ·
 * CreateSchemeDto). Validated at the controller boundary by
 * {@link ZodValidationPipe}; any failure becomes `VALIDATION_ERROR` (400) with
 * field-level issues.
 *
 *  - `code`     1–40 chars, uppercase alphanumeric + hyphens, unique per org
 *               (the `uq_schemes_code` constraint is the authoritative uniqueness
 *               check → CONFLICT; this regex only rejects malformed input).
 *  - `name`     1–120 chars.
 *  - `product_code` optional/nullable enum; `null` (or omitted) means the scheme
 *               applies to ALL products (LLD §Ambiguities #1).
 *  - `subvention_flag` optional, default `false`.
 *  - `valid_from`/`valid_to` ISO `YYYY-MM-DD`; the cross-field rule
 *               `valid_to >= valid_from` mirrors the DB check `ck_schemes_validity`
 *               and surfaces under the `valid_to` path.
 */

const PRODUCT_CODE_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CreateSchemeDto = z
  .object({
    code: z
      .string({ required_error: 'Scheme code is required' })
      .min(1, 'Scheme code is required')
      .max(40, 'Scheme code must not exceed 40 characters')
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Scheme code must be uppercase alphanumeric with hyphens'),
    name: z
      .string({ required_error: 'Scheme name is required' })
      .min(1, 'Scheme name is required')
      .max(120, 'Scheme name must not exceed 120 characters'),
    product_code: z
      .enum(PRODUCT_CODE_VALUES, {
        errorMap: () => ({ message: 'product_code must be one of: CV, CAR, TRACTOR, CE, TW, SBL, HRM' }),
      })
      .nullable()
      .optional()
      .default(null),
    subvention_flag: z.boolean().optional().default(false),
    valid_from: z
      .string({ required_error: 'valid_from must be a date in YYYY-MM-DD format' })
      .regex(ISO_DATE, 'valid_from must be a date in YYYY-MM-DD format'),
    valid_to: z
      .string({ required_error: 'valid_to must be a date in YYYY-MM-DD format' })
      .regex(ISO_DATE, 'valid_to must be a date in YYYY-MM-DD format'),
  })
  .refine((dto) => dto.valid_to >= dto.valid_from, {
    message: 'valid_to must be on or after valid_from',
    path: ['valid_to'],
  });

export type CreateSchemeDto = z.infer<typeof CreateSchemeDto>;
