import { z } from 'zod';

/**
 * FR-082 — Inbound webhook body from the LOS (POST /api/v1/los/webhooks/status).
 *
 * Zod validates AFTER the HmacGuard has already verified the signature; a
 * 400 VALIDATION_ERROR from here means the LOS sent a structurally invalid
 * payload (unusual, but acknowledged without retrying the HMAC path).
 *
 * Fields and rules per FR-082 LLD §Validation Logic. `status` is LOS-owned and
 * stored verbatim — no enum constraint (the LOS defines the status vocabulary).
 */
export const LosStatusWebhookSchema = z.object({
  event_id: z
    .string()
    .min(1, { message: 'event_id is required and must be at most 120 characters' })
    .max(120, { message: 'event_id is required and must be at most 120 characters' }),
  los_application_id: z
    .string()
    .min(1, { message: 'los_application_id is required and must be at most 64 characters' })
    .max(64, { message: 'los_application_id is required and must be at most 64 characters' }),
  status: z
    .string()
    .min(1, { message: 'status is required and must be at most 40 characters' })
    .max(40, { message: 'status is required and must be at most 40 characters' }),
  status_date: z.string().datetime({ message: 'status_date must be a valid ISO-8601 datetime' }),
  correlation_id: z
    .string()
    .max(120, { message: 'correlation_id must be at most 120 characters' })
    .optional(),
  remarks: z
    .string()
    .max(500, { message: 'remarks must be at most 500 characters' })
    .optional(),
});

export type LosStatusWebhookDto = z.infer<typeof LosStatusWebhookSchema>;
