import { z } from 'zod';

const MIN_FUTURE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_FUTURE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * FR-062 — `POST /c/{token}/callback` body (LLD §Validation). `preferred_slot` is
 * an ISO-8601 datetime with timezone, between +30 min and +7 days from now.
 */
export const CallbackRequestDto = z.object({
  preferred_slot: z
    .string({ required_error: 'preferred_slot is required' })
    .datetime({ offset: true, message: 'preferred_slot must be a valid ISO-8601 datetime with timezone' })
    .refine(
      (val) => {
        const t = new Date(val).getTime();
        const now = Date.now();
        return t >= now + MIN_FUTURE_MS && t <= now + MAX_FUTURE_MS;
      },
      { message: 'preferred_slot must be at least 30 minutes in the future and within 7 days' },
    ),
  note: z.string().trim().max(500, 'note must be at most 500 characters').optional(),
});
export type CallbackRequestDto = z.infer<typeof CallbackRequestDto>;
