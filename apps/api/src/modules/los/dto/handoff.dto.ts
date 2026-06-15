import { z } from 'zod';

/**
 * FR-081 — Path parameter schema for POST /leads/:id/handoff.
 */
export const HandoffPathSchema = z.object({
  id: z.string().uuid({ message: 'Lead ID must be a valid UUID' }),
});

export type HandoffPath = z.infer<typeof HandoffPathSchema>;

/**
 * FR-081 — Idempotency-Key header schema.
 * Required (unlike FR-080 where it is optional).
 */
export const HandoffIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(120, { message: 'Idempotency-Key must be 1–120 characters' })
  .regex(/^[\x21-\x7E]+$/, 'Idempotency-Key must be printable ASCII (no spaces)');
