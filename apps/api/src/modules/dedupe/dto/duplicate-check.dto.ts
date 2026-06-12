import { z } from 'zod';

/**
 * FR-020 — `POST /leads/{id}/duplicate-check` optional request body (LLD
 * §Request Body). Validated at the controller boundary by `ZodValidationPipe`;
 * failures become `VALIDATION_ERROR` (400) with field-level issues.
 *
 *  - `requested_action`  optional; one of block|warn|queue|link|override. When
 *                        omitted the service derives the action from the BRD
 *                        default-match table (internal-invocation parity).
 *  - `override_reason`   required (non-blank, ≤ 500 chars) only when
 *                        `requested_action === 'override'` (T16).
 */
export const RequestedDuplicateAction = z.enum(['block', 'warn', 'queue', 'link', 'override'], {
  errorMap: () => ({ message: 'Invalid action value.' }),
});
export type RequestedDuplicateAction = z.infer<typeof RequestedDuplicateAction>;

const DuplicateCheckBody = z
  .object({
    requested_action: RequestedDuplicateAction.optional(),
    override_reason: z
      .string({ invalid_type_error: 'Override reason is required and must not be blank.' })
      .max(500, 'Override reason is required and must not be blank.')
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.requested_action === 'override' &&
      (value.override_reason == null || value.override_reason.trim() === '')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['override_reason'],
        message: 'Override reason is required and must not be blank.',
      });
    }
  });

/** The body is OPTIONAL — an internal/no-body re-check parses as `{}`. */
export const DuplicateCheckDto = z.preprocess((value) => value ?? {}, DuplicateCheckBody);
export type DuplicateCheckDto = z.infer<typeof DuplicateCheckBody>;
