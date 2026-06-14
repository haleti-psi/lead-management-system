import { z } from 'zod';

import { GrievanceStatus } from '@lms/shared';

/**
 * FR-114 — `PATCH /grievances/{id}` request body (LLD §Validation `UpdateGrievanceDto`).
 * All fields are optional; at least one must be present (enforced in service).
 * Status transition guards (response/closureProofRef requirements) are checked in
 * {@link GrievanceService.validateTransition} after reading the current row.
 */
export const UpdateGrievanceDto = z
  .object({
    status: z
      .nativeEnum(GrievanceStatus, {
        errorMap: () => ({
          message:
            'Invalid status transition — status must be a valid grievance_status value.',
        }),
      })
      .optional(),

    response: z.string().max(2000, 'Response must be at most 2000 characters.').optional(),

    closureProofRef: z
      .string()
      .min(1, 'Closure proof reference must not be empty.')
      .max(255, 'Closure proof reference must be at most 255 characters.')
      .optional(),

    ownerId: z.string().uuid('ownerId must be a valid UUID').optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.response !== undefined ||
      data.closureProofRef !== undefined ||
      data.ownerId !== undefined,
    {
      message: 'At least one field must be provided.',
      path: ['status'],
    },
  );

export type UpdateGrievanceDto = z.infer<typeof UpdateGrievanceDto>;
