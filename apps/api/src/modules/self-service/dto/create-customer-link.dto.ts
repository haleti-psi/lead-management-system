import { z } from 'zod';

import { LINK_PURPOSES } from '../self-service.constants';

/**
 * FR-060 — `POST /leads/{id}/customer-link` body (LLD §1). `channel` is the
 * delivery channel for the link (sms/whatsapp/email — not in_app). `purpose`
 * gates which customer actions the token permits.
 */
export const CreateCustomerLinkDto = z.object({
  purpose: z.array(z.enum(LINK_PURPOSES)).min(1, 'At least one purpose is required.'),
  channel: z.enum(['sms', 'whatsapp', 'email'], { errorMap: () => ({ message: 'Invalid channel.' }) }),
  expires_in_days: z.number().int().min(1).max(30).optional(),
  message_override: z.string().max(500).nullable().optional(),
});
export type CreateCustomerLinkDto = z.infer<typeof CreateCustomerLinkDto>;
