import { z } from 'zod';

import { LeadStage } from '@lms/shared';

/**
 * PATCH /api/v1/leads/{id}/stage — request body (FR-052 LLD §Validation).
 *
 * Field names follow docs/lld/CORRECTIONS.md §FR-052 (api-contract StageChange):
 *   `to`               — target stage (not `toStage`)
 *   `expected_version` — optimistic lock (not `expectedVersion`)
 *
 * `reason` is required when `to` is `rejected` or `dormant` (§10.3 guard).
 */
export const StageTransitionDtoSchema = z
  .object({
    to: z
      .enum(
        Object.values(LeadStage) as [string, ...string[]],
        { errorMap: () => ({ message: 'toStage must be a valid lead stage value.' }) },
      )
      .transform((v) => v as (typeof LeadStage)[keyof typeof LeadStage]),
    expected_version: z
      .number({ invalid_type_error: 'expectedVersion must be a positive integer.' })
      .int('expectedVersion must be a positive integer.')
      .min(1, 'expectedVersion must be a positive integer.'),
    reason: z
      .string()
      .max(500, 'reason must not exceed 500 characters.')
      .optional(),
  })
  .refine(
    (data) =>
      data.to !== LeadStage.REJECTED && data.to !== LeadStage.DORMANT
        ? true
        : Boolean(data.reason),
    {
      message: 'reason is required for rejected and dormant transitions.',
      path: ['reason'],
    },
  );

export type StageTransitionDto = z.infer<typeof StageTransitionDtoSchema>;
