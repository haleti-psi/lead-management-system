import { z } from 'zod';

import { Disposition, Priority, TaskStatus } from '@lms/shared';

/**
 * FR-100 + FR-102 — Zod schema for PATCH /api/v1/tasks/:id.
 * All fields are optional; only provided fields are updated.
 *
 * FR-102 additions:
 *   - `geo` extended with range validation (lat/lng/accuracy_m per LLD §Validation)
 *   - Cross-field: `next_action_at` required when disposition is `rescheduled` or
 *     `callback_requested` (service enforces; Zod cannot access the task type for
 *     the geo type-restriction — that check is in the service).
 *
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
        errorMap: () => ({
          message:
            'disposition must be one of: connected, no_answer, wrong_number, not_interested, visited, rescheduled, callback_requested, docs_promised.',
        }),
      })
      .optional()
      .nullable(),
    result_note: z
      .string()
      .max(1000, 'result_note must not exceed 1000 characters.')
      .nullable()
      .optional(),
    geo: z
      .object({
        lat: z
          .number({ invalid_type_error: 'geo.lat must be a number.' })
          .min(-90, 'geo.lat must be between -90 and 90.')
          .max(90, 'geo.lat must be between -90 and 90.'),
        lng: z
          .number({ invalid_type_error: 'geo.lng must be a number.' })
          .min(-180, 'geo.lng must be between -180 and 180.')
          .max(180, 'geo.lng must be between -180 and 180.'),
        accuracy_m: z
          .number({ invalid_type_error: 'geo.accuracy_m must be a number.' })
          .positive('geo.accuracy_m must be a positive number.'),
      })
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
