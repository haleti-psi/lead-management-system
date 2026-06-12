import { z } from 'zod';

import {
  ConsentActor,
  ConsentPurpose,
  ConsentState,
  CustomerType,
  Lang,
  LeadSource,
  MobileSchema,
  PinSchema,
  ProductCode,
} from '@lms/shared';

/**
 * FR-010 — Zod schema for `POST /api/v1/leads` (api-contract `LeadCreate`).
 * Validation rules and messages follow the LLD §Validation Logic table exactly;
 * `ZodValidationPipe` maps failures to `VALIDATION_ERROR` (400) with dotted
 * `fields[].field` paths (e.g. `identity.mobile`, `source.partner_code`).
 */

export const ConsentInputSchema = z.object({
  purpose: z.nativeEnum(ConsentPurpose, { errorMap: () => ({ message: 'Invalid consent purpose.' }) }),
  state: z.nativeEnum(ConsentState, { errorMap: () => ({ message: 'Invalid consent state.' }) }),
  actor: z.nativeEnum(ConsentActor, { errorMap: () => ({ message: 'Invalid consent actor.' }) }),
  notice_version: z.string({ required_error: 'notice_version is required.' }).trim().min(1, 'notice_version is required.'),
  consent_text_version: z
    .string({ required_error: 'consent_text_version is required.' })
    .trim()
    .min(1, 'consent_text_version is required.'),
  language: z.nativeEnum(Lang).optional(),
});
export type ConsentInput = z.infer<typeof ConsentInputSchema>;

export const IdentityInputSchema = z.object({
  name: z.string({ required_error: 'Name is required.' }).trim().min(1, 'Name is required.').max(150, 'Name is required.'),
  mobile: MobileSchema,
  email: z.string().trim().email('Invalid email address.').max(255, 'Invalid email address.').optional(),
  /** Opaque tokenised PAN reference (never a raw PAN). */
  pan_token: z.string().trim().min(1).max(255).optional(),
  /** Display form (`ABCxxxx4F`) accompanying a pan_token. */
  pan_masked: z.string().trim().min(1).max(20).optional(),
  preferred_language: z.nativeEnum(Lang).optional(),
});
export type IdentityInput = z.infer<typeof IdentityInputSchema>;

export const SourceInputSchema = z
  .object({
    source: z.nativeEnum(LeadSource, {
      errorMap: () => ({ message: 'Source is required and must be from the configured master.' }),
    }),
    sub_source: z.string().trim().max(80).optional(),
    partner_code: z.string().trim().min(1).max(40).optional(),
    campaign_code: z.string().trim().max(80).optional(),
    utm: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    const needsPartner = value.source === LeadSource.DSA || value.source === LeadSource.DEALER;
    if (needsPartner && (value.partner_code == null || value.partner_code.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partner_code'],
        message: 'partner_code is required when source is DSA or Dealer.',
      });
    }
  });
export type SourceInput = z.infer<typeof SourceInputSchema>;

/** NUMERIC(15,2) ceiling — 13 integer digits (schema.sql `requested_amount`). */
const REQUESTED_AMOUNT_MAX = 9_999_999_999_999.99;

export const CreateLeadDto = z.object({
  product_code: z.nativeEnum(ProductCode, { errorMap: () => ({ message: 'Invalid product code.' }) }),
  identity: IdentityInputSchema,
  source: SourceInputSchema,
  branch_code: z.string().trim().min(1).max(40).optional(),
  pin_code: PinSchema.optional(),
  requested_amount: z
    .number({ invalid_type_error: 'Requested amount must be a non-negative number.' })
    .min(0, 'Requested amount must be a non-negative number.')
    .max(REQUESTED_AMOUNT_MAX, 'Requested amount must be a non-negative number.')
    .optional(),
  customer_type: z.nativeEnum(CustomerType).optional(),
  product_detail: z.record(z.unknown()).optional(),
  consents: z.array(ConsentInputSchema).max(20).optional(),
});
export type CreateLeadDto = z.infer<typeof CreateLeadDto>;
