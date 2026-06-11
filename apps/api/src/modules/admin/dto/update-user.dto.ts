import { z } from 'zod';

import { ProductCode, UserStatus } from '@lms/shared';

/**
 * FR-130 — `PATCH /admin/users/{id}` request schema (LLD §Validation Logic →
 * UpdateUserDto). All fields are optional (partial update) but at least one must
 * be present. The `status` enum is restricted to `active` / `inactive`: a request
 * to set `locked` (a system-only lockout transition per the User state machine —
 * see LLD §State Machine, T-16) is rejected here as `VALIDATION_ERROR` (400) with
 * field `status`, so the service never sees an illegal transition. `reassign_to`
 * is required only when deactivating a user with open leads — that is a
 * service-level check (it depends on the lead count), not a Zod rule.
 */
const PRODUCT_CODES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];

export const UpdateUserDto = z
  .object({
    full_name: z
      .string()
      .min(2, 'Full name must be 2–150 characters.')
      .max(150, 'Full name must be 2–150 characters.')
      .optional(),
    mobile: z
      .string()
      .regex(/^[6-9][0-9]{9}$/, 'Mobile must be a 10-digit Indian mobile number.')
      .optional(),
    role_id: z.string().uuid('role_id must be a valid UUID.').optional(),
    branch_id: z.string().uuid('branch_id must be a valid UUID.').optional(),
    team_id: z.string().uuid('team_id must be a valid UUID.').optional(),
    region_id: z.string().uuid('region_id must be a valid UUID.').optional(),
    partner_id: z.string().uuid('partner_id must be a valid UUID.').optional(),
    product_skills: z
      .array(z.enum(PRODUCT_CODES, { errorMap: () => ({ message: 'Each product skill must be a valid product code.' }) }))
      .optional(),
    reporting_manager_id: z.string().uuid('reporting_manager_id must be a valid UUID.').optional(),
    mfa_enabled: z.boolean().optional(),
    status: z
      .enum([UserStatus.ACTIVE, UserStatus.INACTIVE], {
        errorMap: () => ({ message: "status must be 'active' or 'inactive'." }),
      })
      .optional(),
    reassign_to: z.string().uuid('reassign_to must be a valid UUID.').optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateUserDto = z.infer<typeof UpdateUserDto>;
