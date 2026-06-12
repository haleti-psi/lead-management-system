import { z } from 'zod';

import { ConsentPurpose, ConsentState, Lang } from '@lms/shared';

import { CUSTOMER_BLOCKED_PURPOSES } from '../compliance.constants';

/**
 * FR-110 — Zod schema for the customer self-service path
 * `POST /api/v1/c/{token}/consent` (api-contract `customerConsent`).
 * Customers may submit `granted`/`denied` only (withdrawal goes through the
 * FR-112 rights-request flow — LLD §Ambiguities 2) and only customer-capturable
 * purposes (all except partner_sharing / aa_bank_data / gst_business_data).
 * `actor`/`channel`/`ip_device` are NEVER client-supplied on this path — they
 * are resolved server-side (LLD §Endpoint 3).
 */
export const CustomerConsentDto = z.object({
  purpose: z
    .nativeEnum(ConsentPurpose, {
      errorMap: () => ({ message: 'purpose is not valid for customer self-service.' }),
    })
    .refine((purpose) => !CUSTOMER_BLOCKED_PURPOSES.has(purpose), {
      message: 'purpose is not valid for customer self-service.',
    }),
  state: z.enum([ConsentState.GRANTED, ConsentState.DENIED], {
    errorMap: () => ({ message: 'state must be granted or denied for customer consent.' }),
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
  language: z
    .nativeEnum(Lang, { errorMap: () => ({ message: 'language must be a supported language.' }) })
    .optional(),
});
export type CustomerConsentDto = z.infer<typeof CustomerConsentDto>;

/** Opaque link token path param (api-contract `Token`: plain string). */
export const TokenParam = z
  .string({ required_error: 'token is required.' })
  .min(1, 'token is required.')
  .max(512, 'token is invalid.');
export type TokenParam = z.infer<typeof TokenParam>;
