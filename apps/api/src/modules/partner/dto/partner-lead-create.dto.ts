import { z } from 'zod';

import { LeadStage, ProductCode } from '@lms/shared';

import { IdentityInputSchema } from '../../capture/dto/create-lead.dto';

const REQUESTED_AMOUNT_MAX = 1_000_000_000;

/**
 * FR-091 — `POST /partners/leads` body (LLD §Validation — PartnerLeadCreateDto).
 * A partner cannot set `source`/`partner_code`/`owner`/`branch`/`stage`: those are
 * derived/forced by the service, and Zod strips any such unknown keys here.
 */
export const PartnerLeadCreateDto = z.object({
  product_code: z.nativeEnum(ProductCode, { errorMap: () => ({ message: 'Select a valid product.' }) }),
  identity: IdentityInputSchema,
  sub_source: z.string().trim().max(80, 'Sub-source is too long.').optional(),
  pin_code: z.string().regex(/^[0-9]{6}$/, 'Enter a valid 6-digit PIN code.').optional(),
  requested_amount: z
    .number({ invalid_type_error: 'Amount must be zero or more.' })
    .min(0, 'Amount must be zero or more.')
    .max(REQUESTED_AMOUNT_MAX, 'Amount must be zero or more.')
    .optional(),
  product_detail: z.record(z.unknown()).optional(),
});
export type PartnerLeadCreateDto = z.infer<typeof PartnerLeadCreateDto>;

/** FR-091 — `GET /partners/leads` query (pagination + optional stage / q). */
export const ListPartnerLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be a positive integer').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be a positive integer')
    .transform((v) => Math.min(v, 100))
    .default(25),
  stage: z.nativeEnum(LeadStage).optional(),
  q: z.string().trim().min(2, 'search needs at least 2 characters').optional(),
});
export type ListPartnerLeadsQuery = z.infer<typeof ListPartnerLeadsQuerySchema>;
