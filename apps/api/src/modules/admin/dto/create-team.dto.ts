import { z } from 'zod';

/**
 * FR-130 — `POST /admin/teams` request schema (LLD §Validation Logic →
 * CreateTeamDto). A team is scoped to a branch (`branch_id`) and may carry a
 * manager user. Existence/active checks on `branch_id` and `manager_id` are
 * service-level (they require a DB read), not Zod rules.
 */
export const CreateTeamDto = z.object({
  name: z
    .string()
    .min(2, 'Team name must be 2–120 characters.')
    .max(120, 'Team name must be 2–120 characters.'),
  branch_id: z.string({ required_error: 'branch_id must be a valid UUID.' }).uuid('branch_id must be a valid UUID.'),
  manager_id: z.string().uuid('manager_id must be a valid UUID.').optional(),
});

export type CreateTeamDto = z.infer<typeof CreateTeamDto>;
