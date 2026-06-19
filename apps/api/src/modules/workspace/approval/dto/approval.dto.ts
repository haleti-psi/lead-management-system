import { z } from 'zod';

import { ApprovalDecision } from '@lms/shared';

/**
 * FR-055 — `POST /leads/{id}/approval` request schema (LLD §Validation Logic).
 * Validated at the controller boundary by `ZodValidationPipe`; any failure
 * becomes `VALIDATION_ERROR` (400) with field-level issues.
 *
 * - `decision`  required enum: 'approve' | 'reject'
 * - `reason`    optional unless `decision === 'reject'` (5–500 chars when present)
 */
export const ApprovalDto = z
  .object({
    decision: z.nativeEnum(ApprovalDecision, {
      required_error: "decision must be 'approve' or 'reject'.",
      invalid_type_error: "decision must be 'approve' or 'reject'.",
    }),
    reason: z
      .string()
      .min(5, 'reason is required when rejecting (min 5, max 500 characters).')
      .max(500, 'reason is required when rejecting (min 5, max 500 characters).')
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === ApprovalDecision.REJECT && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason is required when rejecting (min 5, max 500 characters).',
      });
    }
  });

export type ApprovalDto = z.infer<typeof ApprovalDto>;
