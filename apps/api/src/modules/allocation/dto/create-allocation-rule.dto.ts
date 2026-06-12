import { z } from 'zod';

import { AllocationMethod } from '@lms/shared';

/**
 * FR-030 — `POST /admin/allocation-rules` request schema (LLD §Validation
 * Logic · CreateAllocationRuleDto). Wire shape is snake_case per the
 * api-contract examples. `priority_order` uniqueness per org is the DB
 * constraint `uq_allocation_rules_order` (a clash → CONFLICT 409, T32) — not
 * re-checked here.
 */

const METHOD_VALUES = Object.values(AllocationMethod) as [AllocationMethod, ...AllocationMethod[]];

/** `target` must specify a non-empty `team_ids` string array or a `partner_id`. */
function hasValidTarget(target: Record<string, unknown>): boolean {
  const teamIds = target['team_ids'];
  if (Array.isArray(teamIds) && teamIds.length > 0 && teamIds.every((t) => typeof t === 'string')) {
    return true;
  }
  return typeof target['partner_id'] === 'string' && target['partner_id'].length > 0;
}

export const CreateAllocationRuleDto = z.object({
  name: z
    .string({ required_error: 'name is required, max 120 characters' })
    .min(1, 'name is required, max 120 characters')
    .max(120, 'name is required, max 120 characters'),
  priority_order: z
    .number({
      required_error: 'priority_order must be a positive integer',
      invalid_type_error: 'priority_order must be a positive integer',
    })
    .int('priority_order must be a positive integer')
    .min(1, 'priority_order must be a positive integer'),
  method: z.enum(METHOD_VALUES, {
    errorMap: () => ({
      message: 'method must be one of: round_robin, capacity, specialist, branch, partner, escalation',
    }),
  }),
  criteria: z
    .record(z.unknown(), {
      required_error: 'criteria must be a non-empty object',
      invalid_type_error: 'criteria must be a non-empty object',
    })
    .refine((o) => Object.keys(o).length > 0, 'criteria must be a non-empty object'),
  target: z
    .record(z.unknown(), {
      required_error: 'target must specify team_ids array or partner_id',
      invalid_type_error: 'target must specify team_ids array or partner_id',
    })
    .refine(hasValidTarget, 'target must specify team_ids array or partner_id'),
  capacity_limit: z
    .number({ invalid_type_error: 'capacity_limit must be a positive integer (max 500)' })
    .int('capacity_limit must be a positive integer (max 500)')
    .min(1, 'capacity_limit must be a positive integer (max 500)')
    .max(500, 'capacity_limit must be a positive integer (max 500)')
    .optional(),
  is_active: z
    .boolean({ invalid_type_error: 'is_active must be a boolean' })
    .optional()
    .default(true),
});

export type CreateAllocationRuleDto = z.infer<typeof CreateAllocationRuleDto>;
