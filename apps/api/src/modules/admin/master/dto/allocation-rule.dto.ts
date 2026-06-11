import { z } from 'zod';

import { AllocationMethod } from '@lms/shared';

import { atLeastOneKey } from './common';

const METHOD_VALUES = Object.values(AllocationMethod) as [AllocationMethod, ...AllocationMethod[]];

/**
 * FR-131 — `allocation_rules` master (schema 3.14). `priority_order` is unique
 * per org (DB constraint `uq_allocation_rules_order`; a clash → CONFLICT).
 * `criteria`/`target` are non-empty JSON objects. Org-global → scope-A only.
 */
export const CreateAllocationRuleDto = z.object({
  name: z
    .string({ required_error: 'name is required and must not exceed 120 characters.' })
    .min(1, 'name is required and must not exceed 120 characters.')
    .max(120, 'name is required and must not exceed 120 characters.'),
  priorityOrder: z
    .number({ required_error: 'priorityOrder must be a positive integer.' })
    .int('priorityOrder must be a positive integer.')
    .positive('priorityOrder must be a positive integer.'),
  method: z.enum(METHOD_VALUES, {
    errorMap: () => ({ message: 'method must be a valid allocation method.' }),
  }),
  criteria: z
    .record(z.unknown())
    .refine((v) => Object.keys(v).length > 0, 'criteria must be a non-empty JSON object.'),
  target: z
    .record(z.unknown())
    .refine((v) => Object.keys(v).length > 0, 'target must be a non-empty JSON object.'),
  capacityLimit: z
    .number()
    .int('capacityLimit must be a positive integer.')
    .positive('capacityLimit must be a positive integer.')
    .optional(),
});
export type CreateAllocationRuleDto = z.infer<typeof CreateAllocationRuleDto>;

export const PatchAllocationRuleDto = atLeastOneKey(
  CreateAllocationRuleDto.partial().extend({ isActive: z.boolean().optional() }),
);
export type PatchAllocationRuleDto = z.infer<typeof PatchAllocationRuleDto>;
