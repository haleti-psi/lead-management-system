import { z } from 'zod';

import { PartnerStatus, RiskBand } from '@lms/shared';

import { STATUS_REASON_REQUIRED } from '../partner.constants';

const Uuid = z.string().uuid('Must be a valid UUID.');

/**
 * FR-090 — `PATCH /partners/{id}` body (LLD §Validation — UpdatePartnerDto). All
 * fields optional (partial update). `partnerCode`/`type`/`orgId` are immutable and
 * rejected if present. `statusReason` is required when suspending/expiring.
 */
export const UpdatePartnerDto = z
  .object({
    legalName: z.string().trim().min(1).max(150, 'Legal name must be under 150 characters.').optional(),
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
    status: z
      .nativeEnum(PartnerStatus, { errorMap: () => ({ message: 'Invalid status value.' }) })
      .optional(),
    statusReason: z.string().trim().max(500).optional(),
    // Immutable — rejected with a field-specific message if present.
    partnerCode: z.never({ errorMap: () => ({ message: 'Partner code cannot be changed after creation.' }) }).optional(),
    type: z.never({ errorMap: () => ({ message: 'Partner type cannot be changed after creation.' }) }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status && STATUS_REASON_REQUIRED.has(data.status) && !data.statusReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statusReason'],
        message: 'A reason is required when suspending or expiring a partner.',
      });
    }
  });
export type UpdatePartnerDto = z.infer<typeof UpdatePartnerDto>;
