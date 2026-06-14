import { z } from 'zod';

import { Disposition, Priority, TaskType } from '@lms/shared';

/**
 * FR-100 — Zod schema for POST /api/v1/tasks.
 * Validated at the controller boundary before any service call.
 */
export const CreateTaskDto = z.object({
  lead_id: z
    .string({ required_error: 'lead_id is required and must reference a valid lead.' })
    .uuid('lead_id is required and must reference a valid lead.'),
  type: z.nativeEnum(TaskType, {
    errorMap: () => ({ message: 'type must be a valid task type.' }),
  }),
  owner_id: z
    .string({ required_error: 'owner_id must reference a valid user in the organisation.' })
    .uuid('owner_id must reference a valid user in the organisation.'),
  due_at: z
    .string({ required_error: 'due_at must be a future date and time.' })
    .datetime({ message: 'due_at must be a future date and time.' }),
  priority: z
    .nativeEnum(Priority, { errorMap: () => ({ message: 'priority must be low, normal, or high.' }) })
    .optional()
    .default(Priority.NORMAL),
  sla_policy_id: z.string().uuid('sla_policy_id must reference an active SLA policy.').nullable().optional(),
  result_note: z
    .string()
    .max(1000, 'result_note must not exceed 1000 characters.')
    .nullable()
    .optional(),
  next_action_at: z
    .string()
    .datetime({ message: 'next_action_at must be a valid datetime.' })
    .nullable()
    .optional(),
  geo: z
    .object(
      {
        lat: z.number({ invalid_type_error: 'geo must include numeric lat and lng.' }),
        lng: z.number({ invalid_type_error: 'geo must include numeric lat and lng.' }),
      },
      { invalid_type_error: 'geo must include numeric lat and lng.' },
    )
    .nullable()
    .optional(),
});

export type CreateTaskDto = z.infer<typeof CreateTaskDto>;

/** The subset of {@link Disposition} valid at task creation time (optional). */
export const _dispositionSchema = z.nativeEnum(Disposition);
