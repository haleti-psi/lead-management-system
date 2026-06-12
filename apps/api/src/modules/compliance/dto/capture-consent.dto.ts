import { z } from 'zod';

import {
  ConsentActor,
  ConsentPurpose,
  ConsentState,
  CreationChannel,
  DataCategory,
  Lang,
} from '@lms/shared';

/**
 * FR-110 — Zod schema for the staff path `POST /api/v1/leads/{id}/consents`
 * (api-contract `captureConsent`). Field rules and messages follow the LLD
 * §Validation Logic table exactly; `ZodValidationPipe` maps failures to
 * `VALIDATION_ERROR` (400) with `fields[]`. The system-managed-state and
 * withdraw-without-grant BUSINESS rules are enforced in `ConsentService`, not
 * here (LLD: "applied in service, not Zod").
 */
export const CaptureConsentDto = z.object({
  purpose: z.nativeEnum(ConsentPurpose, {
    errorMap: () => ({ message: 'purpose must be one of the allowed consent purposes.' }),
  }),
  state: z.nativeEnum(ConsentState, {
    errorMap: () => ({ message: 'state must be a valid consent state.' }),
  }),
  notice_version: z
    .string({ required_error: 'notice_version is required.' })
    .trim()
    .min(1, 'notice_version is required.')
    .max(40, 'notice_version is required.'),
  consent_text_version: z
    .string({ required_error: 'consent_text_version is required.' })
    .trim()
    .min(1, 'consent_text_version is required.')
    .max(40, 'consent_text_version is required.'),
  /** Optional; defaults to `manual` on the staff path (LLD §Validation). */
  channel: z
    .nativeEnum(CreationChannel, {
      errorMap: () => ({ message: 'channel must be a valid creation channel.' }),
    })
    .default(CreationChannel.MANUAL),
  language: z
    .nativeEnum(Lang, { errorMap: () => ({ message: 'language must be a supported language.' }) })
    .optional(),
  data_category: z
    .nativeEnum(DataCategory, {
      errorMap: () => ({ message: 'data_category must be a valid data category.' }),
    })
    .optional(),
  /** Optional; defaults to `rm` on the staff path (LLD §Validation). */
  actor: z
    .nativeEnum(ConsentActor, {
      errorMap: () => ({ message: 'actor must be one of: customer, rm, partner, system.' }),
    })
    .default(ConsentActor.RM),
  ip_device: z
    .object(
      {
        ip: z.string({ required_error: 'ip_device must be an object with ip and device.' }).min(1),
        device: z
          .string({ required_error: 'ip_device must be an object with ip and device.' })
          .min(1),
      },
      { errorMap: () => ({ message: 'ip_device must be an object with ip and device.' }) },
    )
    .optional(),
  expires_at: z
    .string()
    .datetime({ offset: true, message: 'expires_at must be a future ISO 8601 datetime.' })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() > Date.now(), {
      message: 'expires_at must be a future ISO 8601 datetime.',
    })
    .optional(),
});
export type CaptureConsentDto = z.infer<typeof CaptureConsentDto>;
