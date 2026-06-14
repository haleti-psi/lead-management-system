import { z } from 'zod';

import { GrievanceCategory } from '@lms/shared';

/**
 * FR-061 — `POST /c/{token}/grievance` body (LLD §Validation). `attachmentNote`
 * is a free-text reference only — no binary upload on this endpoint (LLD AMB-3).
 */
export const CreateGrievanceDto = z.object({
  category: z.nativeEnum(GrievanceCategory, {
    errorMap: () => ({ message: 'Category must be one of the allowed values.' }),
  }),
  description: z
    .string({ required_error: 'Description is required.' })
    .trim()
    .min(1, 'Description is required.')
    .max(2000, 'Description must not exceed 2000 characters.'),
  attachmentNote: z.string().trim().max(500, 'Attachment note must not exceed 500 characters.').optional(),
});
export type CreateGrievanceDto = z.infer<typeof CreateGrievanceDto>;
