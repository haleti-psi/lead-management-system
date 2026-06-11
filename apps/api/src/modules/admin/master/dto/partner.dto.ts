import { z } from 'zod';

import { PartnerType, RiskBand } from '@lms/shared';

import { atLeastOneKey, isoDate } from './common';

const TYPE_VALUES = Object.values(PartnerType) as [PartnerType, ...PartnerType[]];
const RISK_VALUES = Object.values(RiskBand) as [RiskBand, ...RiskBand[]];
const mobile = z.string().regex(/^[6-9]\d{9}$/, 'contactMobile must be a valid 10-digit mobile number.');

/**
 * FR-131 — `partners` master (schema 3.7). `partner_code` unique per org;
 * `type` is a `partner_type` enum value. `partners` uses a `status` column
 * (`active`/`suspended`/`expired`), not `is_active`, so deactivation is a status
 * change handled via PATCH `status`.
 */
export const CreatePartnerDto = z.object({
  partnerCode: z
    .string({ required_error: 'partnerCode is required.' })
    .min(1, 'partnerCode is required.')
    .max(20, 'partnerCode must not exceed 20 characters.'),
  type: z.enum(TYPE_VALUES, { errorMap: () => ({ message: 'type must be a valid partner type.' }) }),
  legalName: z
    .string({ required_error: 'legalName is required.' })
    .min(1, 'legalName is required.')
    .max(150, 'legalName must not exceed 150 characters.'),
  branchId: z.string().uuid('branchId must be a valid UUID.').optional(),
  products: z.array(z.string()).optional(),
  contactPerson: z.string().max(150).optional(),
  contactMobile: mobile.optional(),
  agreementRef: z.string().max(80).optional(),
  commissionFlag: z.boolean().optional(),
  riskCategory: z
    .enum(RISK_VALUES, { errorMap: () => ({ message: 'riskCategory must be a valid risk band.' }) })
    .optional(),
  validUntil: isoDate('validUntil must be a valid date.').optional(),
});
export type CreatePartnerDto = z.infer<typeof CreatePartnerDto>;

export const PatchPartnerDto = atLeastOneKey(
  CreatePartnerDto.partial().extend({
    status: z
      .enum(['active', 'suspended', 'expired'], {
        errorMap: () => ({ message: 'status must be active, suspended, or expired.' }),
      })
      .optional(),
  }),
);
export type PatchPartnerDto = z.infer<typeof PatchPartnerDto>;
