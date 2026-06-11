import { z } from 'zod';

import { Capability, DataScope } from '@lms/shared';

/**
 * FR-130 — `PATCH /admin/roles/{id}` request schema (LLD §Validation Logic →
 * UpdateRoleDto). All fields optional; at least one must be present. When
 * `permissions` is supplied it REPLACES the role's whole permission set, so each
 * entry must carry a valid `capability` (from the capability enum) and a
 * `max_scope` (from the data_scope enum). The role `code` is a fixed enum and is
 * never editable here (Assumption A-4): ADMIN configures an existing role's
 * permission set, it does not mint new role codes.
 */
const CAPABILITIES = Object.values(Capability) as [Capability, ...Capability[]];
const SCOPES = Object.values(DataScope) as [DataScope, ...DataScope[]];

export const RolePermissionInput = z.object({
  capability: z.enum(CAPABILITIES, {
    errorMap: () => ({ message: 'Each permission must have valid capability and max_scope.' }),
  }),
  max_scope: z.enum(SCOPES, {
    errorMap: () => ({ message: 'Each permission must have valid capability and max_scope.' }),
  }),
});

export type RolePermissionInput = z.infer<typeof RolePermissionInput>;

export const UpdateRoleDto = z
  .object({
    name: z
      .string()
      .min(2, 'Name must be 2–80 characters.')
      .max(80, 'Name must be 2–80 characters.')
      .optional(),
    default_scope: z
      .enum(SCOPES, { errorMap: () => ({ message: 'default_scope must be a valid scope.' }) })
      .optional(),
    permissions: z.array(RolePermissionInput).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateRoleDto = z.infer<typeof UpdateRoleDto>;
