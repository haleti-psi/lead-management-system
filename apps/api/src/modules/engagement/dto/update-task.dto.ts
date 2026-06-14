import { z } from 'zod';

import { Disposition, Priority, TaskStatus } from '@lms/shared';

/**
 * FR-100 — Zod schema for PATCH /api/v1/tasks/:id.
 * All fields are optional; only provided fields are updated.
 * Disposition validation and status-transition enforcement happen in the service.
 */
export const UpdateTaskDto = z
  .object({
    status: z
      .nativeEnum(TaskStatus, {
        errorMap: () => ({ message: 'Invalid status transition for this task.' }),
      })
      .optional(),
    disposition: z
      .nativeEnum(Disposition, {
        errorMap: () => ({ message: 'disposition is required when completing a task.' }),
      })
      .optional()
      .nullable(),
    result_note: z
      .string()
      .max(1000, 'result_note must not exceed 1000 characters.')
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
    next_action_at: z
      .string()
      .datetime({ message: 'next_action_at must be a valid datetime.' })
      .nullable()
      .optional(),
    owner_id: z
      .string()
      .uuid('owner_id can only be changed by BM or SM.')
      .optional(),
    due_at: z
      .string()
      .datetime({ message: 'due_at must be a valid datetime.' })
      .optional(),
    priority: z
      .nativeEnum(Priority, {
        errorMap: () => ({ message: 'priority must be low, normal, or high.' }),
      })
      .optional(),
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateTaskDto = z.infer<typeof UpdateTaskDto>;
