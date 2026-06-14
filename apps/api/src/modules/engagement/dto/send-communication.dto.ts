import { z } from 'zod';

import { CommChannel, ConsentPurpose } from '@lms/shared';

/** Mobile regex — Indian mobile numbers starting with 6-9, 10 digits total. */
const INDIA_MOBILE_RE = /^[6-9]\d{9}$/;
/** Permissive RFC 5321 email regex (for validation purposes). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * FR-101 — Zod schema for POST /api/v1/leads/{id}/communications.
 * Recipient format is validated per channel.
 */
export const SendCommunicationDto = z
  .object({
    template_id: z
      .string({ required_error: 'template_id must be a valid UUID.' })
      .uuid('template_id must be a valid UUID.'),
    channel: z.nativeEnum(CommChannel, {
      errorMap: () => ({ message: 'Channel must be one of: in_app, email, sms, whatsapp.' }),
    }),
    consent_basis: z.nativeEnum(ConsentPurpose, {
      errorMap: () => ({ message: 'consent_basis must be a valid consent purpose.' }),
    }),
    recipient: z.string({ required_error: 'Recipient format is invalid for the selected channel.' }),
  })
  .superRefine((data, ctx) => {
    if (data.channel === CommChannel.SMS || data.channel === CommChannel.WHATSAPP) {
      if (!INDIA_MOBILE_RE.test(data.recipient)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Recipient format is invalid for the selected channel.',
          path: ['recipient'],
        });
      }
    } else if (data.channel === CommChannel.EMAIL) {
      if (!EMAIL_RE.test(data.recipient)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Recipient format is invalid for the selected channel.',
          path: ['recipient'],
        });
      }
    }
  });

export type SendCommunicationDto = z.infer<typeof SendCommunicationDto>;
