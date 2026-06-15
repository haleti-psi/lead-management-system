import { z } from 'zod';

/**
 * FR-070 — `POST /leads/{id}/documents/{did}/waive` body (LLD §Validation Logic
 * — WaiverDto). The caller-role check (KYC/BM only) is enforced in
 * `DocumentService` via `EntitlementService.can('verify_doc', …)`, not here.
 */
export const WaiverDto = z.object({
  reason: z
    .string({ required_error: 'Waiver reason is required (10–500 characters).' })
    .trim()
    .min(10, 'Waiver reason is required (10–500 characters).')
    .max(500, 'Waiver reason is required (10–500 characters).'),
  /** Optional ISO date; if present must be at least tomorrow (≥ today + 1 day). */
  expires_at: z
    .string()
    .datetime({ offset: true, message: 'Expiry date must be in the future.' })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in the future.'))
    .transform((value) => new Date(value))
    .refine((date) => !Number.isNaN(date.getTime()), { message: 'Expiry date must be in the future.' })
    .refine((date) => date.getTime() >= startOfTomorrow(), {
      message: 'Expiry date must be in the future.',
    })
    .optional(),
  review_note: z.string().trim().max(500, 'Review note must be 500 characters or fewer.').optional(),
});
export type WaiverDto = z.infer<typeof WaiverDto>;

/** Midnight (local) of the next day, in epoch ms — the waiver expiry floor. */
function startOfTomorrow(): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t.getTime() + 24 * 60 * 60 * 1000;
}
