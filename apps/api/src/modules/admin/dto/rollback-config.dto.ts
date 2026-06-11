import { z } from 'zod';

/**
 * FR-132 — `POST /admin/config/{id}/rollback` request schema (LLD §Validation).
 * `reason` is mandatory (destructive action). Validated by {@link ZodValidationPipe};
 * failures map to `VALIDATION_ERROR` (400). Unknown fields are stripped.
 */
export const RollbackConfigDto = z.object({
  reason: z
    .string({ required_error: 'reason is required and must not exceed 500 characters' })
    .min(1, 'reason is required and must not exceed 500 characters')
    .max(500, 'reason is required and must not exceed 500 characters'),
});

export type RollbackConfigDto = z.infer<typeof RollbackConfigDto>;
