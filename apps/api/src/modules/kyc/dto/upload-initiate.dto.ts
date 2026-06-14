import { z } from 'zod';

import { ApplicantScope, DocType } from '@lms/shared';

/**
 * FR-070 — Phase A (initiate) body for `POST /leads/{id}/documents` (LLD
 * §Validation Logic — UploadInitiateDto). `file_type` and `file_size_kb` shape
 * is validated here; the MEDIA-type allow-list (415 UNSUPPORTED_MEDIA) and the
 * size ceiling (413 PAYLOAD_TOO_LARGE) are enforced in `DocumentService` because
 * those map to non-400 error codes that Zod cannot express (LLD §Error Cases).
 * `ZodValidationPipe` maps a shape failure here to `VALIDATION_ERROR` (400).
 */
export const UploadInitiateDto = z.object({
  doc_type: z.nativeEnum(DocType, {
    errorMap: () => ({ message: 'Invalid document type.' }),
  }),
  applicant_scope: z.nativeEnum(ApplicantScope, {
    errorMap: () => ({ message: 'Invalid applicant scope.' }),
  }),
  file_name: z
    .string({ required_error: 'File name is required.' })
    .trim()
    .min(1, 'File name is required.')
    .max(255, 'File name is required.'),
  file_type: z
    .string({ required_error: 'Unsupported file type.' })
    .trim()
    .min(1, 'Unsupported file type.')
    .max(100, 'Unsupported file type.'),
  file_size_kb: z
    .number({ required_error: 'File size is required.', invalid_type_error: 'File size is required.' })
    .int('File size is required.')
    .min(1, 'File size is required.'),
});
export type UploadInitiateDto = z.infer<typeof UploadInitiateDto>;
