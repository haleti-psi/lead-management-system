import { z } from 'zod';

import { PartnerType, RiskBand } from '@lms/shared';

const Uuid = z.string().uuid('Must be a valid UUID.');

/**
 * FR-090 — `POST /partners` body (LLD §Validation — CreatePartnerDto).
 * `partnerCode` and `type` are set at creation and immutable thereafter.
 */
export const CreatePartnerDto = z.object({
  partnerCode: z
    .string()
    .trim()
    .min(1, 'Partner code must be 1–20 alphanumeric characters.')
    .max(20, 'Partner code must be 1–20 alphanumeric characters.')
    .regex(/^[A-Z0-9_-]+$/i, 'Partner code must be 1–20 alphanumeric characters.'),
  type: z.nativeEnum(PartnerType, {
    errorMap: () => ({ message: 'Type must be one of: DSA, Dealer, Connector, OEM, Aggregator, Referral.' }),
  }),
  legalName: z
    .string()
    .trim()
    .min(1, 'Legal name is required and must be under 150 characters.')
    .max(150, 'Legal name is required and must be under 150 characters.'),
  branchId: Uuid.nullable().optional(),
  products: z.array(z.string().min(1)).min(1, 'Products must be a non-empty array.').optional(),
  contactPerson: z.string().trim().max(150).optional(),
  contactMobile: z.string().regex(/^[6-9][0-9]{9}$/, 'Mobile must be a valid 10-digit Indian mobile number.').optional(),
  agreementRef: z.string().trim().max(80, 'Agreement reference must be under 80 characters.').optional(),
  commissionFlag: z.boolean().optional(),
  mappedRmId: Uuid.nullable().optional(),
  riskCategory: z
    .nativeEnum(RiskBand, { errorMap: () => ({ message: 'Risk category must be one of: low, medium, high.' }) })
    .optional(),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid until must be a future date.')
    .refine((d) => new Date(`${d}T00:00:00Z`).getTime() > Date.now(), 'Valid until must be a future date.')
    .optional(),
});
export type CreatePartnerDto = z.infer<typeof CreatePartnerDto>;
