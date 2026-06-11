import { z } from 'zod';

/**
 * FR-132 — `POST /admin/config/{id}/approve` request schema (LLD §Validation).
 * Validated at the controller boundary by {@link ZodValidationPipe}; any failure
 * becomes `VALIDATION_ERROR` (400) with field-level issues. Unknown fields are
 * stripped (Zod's default `strip` mode).
 */
export const ApproveConfigDto = z.object({
  action: z.enum(['approved', 'rejected'], {
    errorMap: () => ({ message: "action must be 'approved' or 'rejected'" }),
  }),
  comment: z
    .string()
    .max(500, 'comment must not exceed 500 characters')
    .optional(),
});

export type ApproveConfigDto = z.infer<typeof ApproveConfigDto>;
