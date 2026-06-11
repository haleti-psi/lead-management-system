import { z } from 'zod';

import { DataCategory, LeadOutcome, RetentionAction } from '@lms/shared';

import { atLeastOneKey } from './common';

const CATEGORY_VALUES = Object.values(DataCategory) as [DataCategory, ...DataCategory[]];
const ACTION_VALUES = Object.values(RetentionAction) as [RetentionAction, ...RetentionAction[]];
const OUTCOME_VALUES = Object.values(LeadOutcome) as [LeadOutcome, ...LeadOutcome[]];

/**
 * FR-131 — `retention_policies` master (schema 3.18). `retain_days` ≥ 0;
 * `legal_hold` defaults false. A policy with `legal_hold=true` cannot be
 * deactivated (in-use check → CONFLICT + `detail.reason = 'LEGAL_HOLD'`).
 */
export const CreateRetentionPolicyDto = z.object({
  dataCategory: z.enum(CATEGORY_VALUES, {
    errorMap: () => ({ message: 'dataCategory must be a valid data category.' }),
  }),
  leadOutcome: z
    .enum(OUTCOME_VALUES, { errorMap: () => ({ message: 'leadOutcome must be a valid lead outcome.' }) })
    .optional(),
  retainDays: z
    .number({ required_error: 'retainDays must be a non-negative integer.' })
    .int('retainDays must be a non-negative integer.')
    .min(0, 'retainDays must be a non-negative integer.'),
  action: z.enum(ACTION_VALUES, {
    errorMap: () => ({ message: 'action must be a valid retention action.' }),
  }),
  legalHold: z.boolean({ invalid_type_error: 'legalHold must be a boolean.' }).optional(),
});
export type CreateRetentionPolicyDto = z.infer<typeof CreateRetentionPolicyDto>;

export const PatchRetentionPolicyDto = atLeastOneKey(
  CreateRetentionPolicyDto.partial().extend({ isActive: z.boolean().optional() }),
);
export type PatchRetentionPolicyDto = z.infer<typeof PatchRetentionPolicyDto>;
