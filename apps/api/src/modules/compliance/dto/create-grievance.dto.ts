import { z } from 'zod';

import { GrievanceCategory, GrievanceSource } from '@lms/shared';

/**
 * FR-114 — `POST /grievances` request body (LLD §Validation `CreateGrievanceDto`).
 * Zod schema; validated by {@link ZodValidationPipe} at the controller boundary.
 */
export const CreateGrievanceDto = z.object({
  leadId: z
    .string()
    .uuid('leadId must be a valid UUID')
    .nullish()
    .transform((v) => v ?? null),

  source: z.nativeEnum(GrievanceSource, {
    errorMap: () => ({
      message:
        'Source must be one of: customer_link, rm, branch, call_centre, partner, admin.',
    }),
  }),

  category: z.nativeEnum(GrievanceCategory, {
    errorMap: () => ({
      message:
        'Category must be one of: service_delay, mis_selling, data_privacy, document_issue, staff_conduct, other.',
    }),
  }),

  description: z
    .string({
      required_error: 'Description must be between 10 and 2000 characters.',
    })
    .min(10, 'Description must be between 10 and 2000 characters.')
    .max(2000, 'Description must be between 10 and 2000 characters.'),

  ownerId: z
    .string()
    .uuid('ownerId must be a valid UUID')
    .nullish()
    .transform((v) => v ?? null),
});

export type CreateGrievanceDto = z.infer<typeof CreateGrievanceDto>;
