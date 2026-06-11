import { z } from 'zod';

/**
 * FR-130 — `PATCH /admin/teams/{id}` request schema (LLD §Validation Logic →
 * UpdateTeamDto). All fields optional (partial update); at least one must be
 * present. `is_active: false` deactivates the team. Existence/active checks on
 * `branch_id` / `manager_id` are service-level.
 */
export const UpdateTeamDto = z
  .object({
    name: z
      .string()
      .min(2, 'Team name must be 2–120 characters.')
      .max(120, 'Team name must be 2–120 characters.')
      .optional(),
    branch_id: z.string().uuid('branch_id must be a valid UUID.').optional(),
    manager_id: z.string().uuid('manager_id must be a valid UUID.').optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateTeamDto = z.infer<typeof UpdateTeamDto>;
