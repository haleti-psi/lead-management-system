import { z } from 'zod';

import { RoleCode, SlaTarget } from '@lms/shared';

/**
 * FR-104 — `POST /admin/sla-policies` request schema (LLD §Validation Logic).
 * Validated at the controller boundary by {@link ZodValidationPipe}; every
 * failure becomes `VALIDATION_ERROR` (400) with field-level issues. The
 * cross-field rules (distinct `at_minutes`; `reassign` appears at most once and,
 * when present, is the highest `at_minutes`) are enforced here via `superRefine`
 * so they surface under the `escalation_chain` field exactly as the spec requires.
 */

const SLA_TARGET_VALUES = Object.values(SlaTarget) as [SlaTarget, ...SlaTarget[]];
const ROLE_CODE_VALUES = Object.values(RoleCode) as [RoleCode, ...RoleCode[]];

export const EscalationStepSchema = z.object({
  at_minutes: z
    .number({ required_error: 'at_minutes must be a positive integer.' })
    .int('at_minutes must be a positive integer.')
    .positive('at_minutes must be a positive integer.'),
  notify_roles: z
    .array(z.enum(ROLE_CODE_VALUES, { errorMap: () => ({ message: 'notify_roles must be a non-empty array of valid roles.' }) }))
    .min(1, 'notify_roles must be a non-empty array of valid roles.'),
  action: z.enum(['notify', 'reassign'], {
    errorMap: () => ({ message: "action must be 'notify' or 'reassign'." }),
  }),
});
export type EscalationStepInput = z.infer<typeof EscalationStepSchema>;

export const CreateSlaPolicyDto = z
  .object({
    name: z
      .string({ required_error: 'Name is required and must be at most 120 characters.' })
      .min(1, 'Name is required and must be at most 120 characters.')
      .max(120, 'Name is required and must be at most 120 characters.'),
    applies_to: z.enum(SLA_TARGET_VALUES, {
      errorMap: () => ({ message: 'applies_to must be a valid SLA target.' }),
    }),
    condition: z.record(z.unknown()).nullable().optional(),
    threshold_minutes: z
      .number({ required_error: 'Threshold must be a positive integer (business minutes).' })
      .int('Threshold must be a positive integer (business minutes).')
      .positive('Threshold must be a positive integer (business minutes).'),
    escalation_chain: z
      .array(EscalationStepSchema)
      .min(1, 'Escalation chain must have at least one step.'),
    // No `is_active` here: activation is server-controlled via maker-checker
    // (the repository forces `is_active=false` on insert; FR-132 approval flips it).
  })
  .superRefine((dto, ctx) => {
    const steps = dto.escalation_chain;

    // Rule 1 — all at_minutes must be distinct.
    const seen = new Set<number>();
    let hasDuplicate = false;
    for (const step of steps) {
      if (seen.has(step.at_minutes)) {
        hasDuplicate = true;
        break;
      }
      seen.add(step.at_minutes);
    }
    if (hasDuplicate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['escalation_chain'],
        message: 'Duplicate at_minutes values are not allowed.',
      });
    }

    // Rule 2 — a `reassign` action appears at most once and, if present, must be
    // the step with the highest at_minutes.
    const reassignSteps = steps.filter((s) => s.action === 'reassign');
    if (reassignSteps.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['escalation_chain'],
        message: 'Only one reassign step is allowed per escalation chain.',
      });
    } else if (reassignSteps.length === 1) {
      const maxAt = Math.max(...steps.map((s) => s.at_minutes));
      if (reassignSteps[0]!.at_minutes !== maxAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['escalation_chain'],
          message: 'The reassign step must be the final (highest at_minutes) step.',
        });
      }
    }
  });

export type CreateSlaPolicyDto = z.infer<typeof CreateSlaPolicyDto>;
