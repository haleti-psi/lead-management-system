import { z } from 'zod';

import { RightsStatus } from '@lms/shared';

/** Statuses that require a disposition string (LLD §Validation UpdateDataRightsDto). */
const FINALISING_STATUSES: ReadonlySet<string> = new Set([
  RightsStatus.FULFILLED,
  RightsStatus.REJECTED_RETAINED,
]);

/**
 * FR-112 — `PATCH /data-rights/{id}` request body (LLD §Validation UpdateDataRightsDto).
 * Validated by {@link ZodValidationPipe} at the controller boundary.
 */
export const UpdateDataRightsDto = z
  .object({
    status: z.nativeEnum(RightsStatus, {
      required_error: 'status is required.',
      errorMap: () => ({
        message:
          'status must be one of: open, in_review, fulfilled, rejected_retained.',
      }),
    }),

    disposition: z
      .string()
      .min(1, 'disposition is required when finalising a request.')
      .max(500, 'disposition must be at most 500 characters.')
      .optional(),

    ownerId: z
      .string()
      .uuid('owner_id must be a valid UUID.')
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (FINALISING_STATUSES.has(val.status) && !val.disposition?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disposition'],
        message: 'disposition is required when finalising a request.',
      });
    }
  });

export type UpdateDataRightsDto = z.infer<typeof UpdateDataRightsDto>;
