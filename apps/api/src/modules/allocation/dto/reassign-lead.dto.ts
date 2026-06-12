import { z } from 'zod';

/**
 * FR-030 — `POST /leads/{id}/reassign` request schema (LLD §Validation Logic ·
 * ReassignLeadDto). Validated at the controller boundary by `ZodValidationPipe`;
 * any failure becomes `VALIDATION_ERROR` (400) with field-level issues
 * (T12–T14).
 *
 *  - `new_owner_id`       required UUID of the target RM.
 *  - `reason`             required, 5–500 chars — every reassignment is auditable.
 *  - `override_capacity`  optional, default false; honoured only for BM (scope B)
 *                         / HEAD (scope A) — SM gets FORBIDDEN (service check).
 */
export const ReassignLeadDto = z.object({
  new_owner_id: z
    .string({ required_error: 'new_owner_id must be a valid UUID' })
    .uuid('new_owner_id must be a valid UUID'),
  reason: z
    .string({ required_error: 'Reason is required (min 5, max 500 characters)' })
    .min(5, 'Reason is required (min 5, max 500 characters)')
    .max(500, 'Reason is required (min 5, max 500 characters)'),
  override_capacity: z
    .boolean({ invalid_type_error: 'override_capacity must be a boolean' })
    .optional()
    .default(false),
});

export type ReassignLeadDto = z.infer<typeof ReassignLeadDto>;
