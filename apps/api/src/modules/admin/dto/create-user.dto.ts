import { z } from 'zod';

import { ProductCode } from '@lms/shared';

/**
 * FR-130 — `POST /admin/users` request schema (LLD §Validation Logic →
 * CreateUserDto). Validated at the controller boundary by {@link ZodValidationPipe};
 * any failure becomes `VALIDATION_ERROR` (400) with field-level issues. Unknown
 * fields are stripped (Zod default `strip`). The temporary password is generated
 * server-side and argon2-hashed — it is never accepted in the request body
 * (security.md: no caller-supplied password on admin user create).
 */
const PRODUCT_CODES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];

export const CreateUserDto = z.object({
  username: z
    .string()
    .min(3, 'Username must be 3–150 alphanumeric/dot/dash characters.')
    .max(150, 'Username must be 3–150 alphanumeric/dot/dash characters.')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username must be 3–150 alphanumeric/dot/dash characters.'),
  email: z
    .string()
    .max(255, 'Must be a valid email address.')
    .email('Must be a valid email address.'),
  full_name: z
    .string()
    .min(2, 'Full name must be 2–150 characters.')
    .max(150, 'Full name must be 2–150 characters.'),
  mobile: z
    .string()
    .regex(/^[6-9][0-9]{9}$/, 'Mobile must be a 10-digit Indian mobile number.')
    .optional(),
  role_id: z.string({ required_error: 'role_id must be a valid UUID.' }).uuid('role_id must be a valid UUID.'),
  branch_id: z.string().uuid('branch_id must be a valid UUID.').optional(),
  team_id: z.string().uuid('team_id must be a valid UUID.').optional(),
  region_id: z.string().uuid('region_id must be a valid UUID.').optional(),
  partner_id: z.string().uuid('partner_id must be a valid UUID.').optional(),
  product_skills: z
    .array(z.enum(PRODUCT_CODES, { errorMap: () => ({ message: 'Each product skill must be a valid product code.' }) }))
    .optional(),
  reporting_manager_id: z.string().uuid('reporting_manager_id must be a valid UUID.').optional(),
  mfa_enabled: z.boolean().default(false),
});

export type CreateUserDto = z.infer<typeof CreateUserDto>;
