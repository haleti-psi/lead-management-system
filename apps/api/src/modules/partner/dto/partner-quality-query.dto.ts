import { z } from 'zod';

/**
 * FR-092 — `GET /partners/{id}/quality` query (LLD §Validation). Optional
 * `from`/`to` ISO dates (YYYY-MM-DD); when both present, `from` must not be after
 * `to`. Absent → the service uses a rolling 30-day window.
 */
export const PartnerQualityQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date.').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date.').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to && data.from > data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: "Date range is invalid: 'from' must not be after 'to'.",
      });
    }
  });
export type PartnerQualityQuery = z.infer<typeof PartnerQualityQuerySchema>;
