import { z } from 'zod';

import { ALLOWED_RESOLUTION_CODES, EVIDENCE_REQUIRED_CODES } from '../kyc.constants';

/**
 * FR-072 — `PATCH /leads/{id}/kyc/{kid}/resolve` body (LLD §Validation Logic).
 * `evidenceRef` is required for waiver / provider_down_manual codes. The codes
 * list is A-3 best-effort (not a DB enum). `ZodValidationPipe` maps a failure to
 * `VALIDATION_ERROR` (400) with `fields[]`.
 */
export const ResolveKycExceptionDto = z
  .object({
    resolutionCode: z.enum(ALLOWED_RESOLUTION_CODES, {
      errorMap: () => ({ message: 'Resolution code is not valid.' }),
    }),
    remarks: z
      .string({ required_error: 'Remarks are required (max 1000 characters).' })
      .trim()
      .min(1, 'Remarks are required (max 1000 characters).')
      .max(1000, 'Remarks are required (max 1000 characters).'),
    evidenceRef: z.string().trim().max(255).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (EVIDENCE_REQUIRED_CODES.has(data.resolutionCode) && !data.evidenceRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceRef'],
        message: 'Evidence reference is required for waiver and provider downtime manual resolution.',
      });
    }
  });
export type ResolveKycExceptionDto = z.infer<typeof ResolveKycExceptionDto>;
