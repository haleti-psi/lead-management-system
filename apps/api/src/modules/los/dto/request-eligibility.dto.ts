import { z } from 'zod';

/**
 * Path parameter schema for POST /leads/:id/eligibility.
 * Validates that :id is a valid UUID v4.
 */
export const RequestEligibilityParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export type RequestEligibilityParam = z.infer<typeof RequestEligibilityParamSchema>;

/**
 * Idempotency-Key header schema (LLD §Validation Logic).
 * Optional — max 120 chars, printable ASCII (U+0021–U+007E, no space).
 */
export const IdempotencyKeyHeaderSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\x21-\x7E]+$/, 'Idempotency-Key must be printable ASCII (no spaces), max 120 chars')
  .optional();
