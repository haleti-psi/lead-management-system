import { z } from 'zod';

import { LeadSource, MobileSchema, PinSchema, ProductCode, Lang } from '@lms/shared';

import { ConsentInputSchema } from './create-lead.dto';

/**
 * FR-010 — Zod schema for `POST /api/v1/public/leads` (api-contract
 * `publicCreateLead`). The public surface is the minimal QR/website form: no
 * branch/partner attribution (DSA/Dealer require a partner and are therefore
 * rejected here), no PAN token, no customer_type. `channel_created_by` is forced
 * from the `?channel=` query param — never from the body.
 */

const PublicSourceSchema = z
  .object({
    source: z.nativeEnum(LeadSource, {
      errorMap: () => ({ message: 'Source is required and must be from the configured master.' }),
    }),
    sub_source: z.string().trim().max(80).optional(),
    campaign_code: z.string().trim().max(80).optional(),
    utm: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === LeadSource.DSA || value.source === LeadSource.DEALER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partner_code'],
        message: 'partner_code is required when source is DSA or Dealer.',
      });
    }
  });

export const PublicCreateLeadDto = z.object({
  product_code: z.nativeEnum(ProductCode, { errorMap: () => ({ message: 'Invalid product code.' }) }),
  identity: z.object({
    name: z.string({ required_error: 'Name is required.' }).trim().min(1, 'Name is required.').max(150, 'Name is required.'),
    mobile: MobileSchema,
    email: z.string().trim().email('Invalid email address.').max(255, 'Invalid email address.').optional(),
    preferred_language: z.nativeEnum(Lang).optional(),
  }),
  source: PublicSourceSchema.default({ source: LeadSource.WEBSITE }),
  pin_code: PinSchema.optional(),
  requested_amount: z
    .number({ invalid_type_error: 'Requested amount must be a non-negative number.' })
    .min(0, 'Requested amount must be a non-negative number.')
    .optional(),
  product_detail: z.record(z.unknown()).optional(),
  consents: z.array(ConsentInputSchema).max(20).optional(),
});
export type PublicCreateLeadDto = z.infer<typeof PublicCreateLeadDto>;

/** `?channel=qr|website` — forced server-side; defaults to `website` (LLD §Auth Check). */
export const PublicChannelParam = z.enum(['qr', 'website']).default('website');
export type PublicChannelParam = z.infer<typeof PublicChannelParam>;
