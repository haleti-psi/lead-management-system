import { z } from 'zod';

import { EventCode } from '@lms/shared';

/**
 * Request schema for `POST /admin/webhooks` (LLD §Validation Logic —
 * CreateWebhookSchema). `targetUrl` MUST be https (mirrors the DB CHECK
 * `ck_webhook_https`); `secretRef` is a Secret Manager resource path (≤120 to
 * match `webhook_subscriptions.secret_ref VARCHAR(120)`) — never the secret
 * value. `eventCode` must be a known `event_code` enum literal.
 */
export const CreateWebhookSchema = z.object({
  eventCode: z.nativeEnum(EventCode),
  targetUrl: z
    .string()
    .min(10, 'URL is too short')
    .max(255, 'URL must be at most 255 characters')
    .refine((v) => v.startsWith('https://'), { message: 'Must begin with https://' }),
  secretRef: z
    .string()
    .min(10, 'secretRef is too short')
    .max(120, 'secretRef must be at most 120 characters')
    .refine((v) => v.startsWith('projects/'), {
      message: 'Must be a valid Secret Manager resource name (projects/…)',
    }),
});

export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;
