import { z } from 'zod';

import { ConfigStatus } from '@lms/shared';

import { crossValidateEligibilityMapping } from './create-product-config.dto';
import {
  DocumentChecklistSchema,
  EligibilityMappingSchema,
  FieldSchemaSchema,
  PAN_TIMING_VALUES,
  SlaConfigSchema,
} from './product-config-schema';

/**
 * FR-040 — `PATCH /admin/products/{id}` request schema (LLD §Validation Logic ·
 * UpdateProductConfigDto). All fields are optional but at least one must be
 * present. `status` accepts ONLY `retired` (the draft→active transition is
 * checker-driven via FR-132, never via PATCH). When both `field_schema` and
 * `eligibility_mapping` are submitted together they are cross-validated here; when
 * `field_schema` is omitted the service re-checks the mapping against the existing
 * row's schema (the merged-schema rule the LLD describes).
 */
export const UpdateProductConfigDto = z
  .object({
    name: z
      .string()
      .min(1, 'name must be 1–120 characters')
      .max(120, 'name must be 1–120 characters')
      .optional(),
    field_schema: FieldSchemaSchema.optional(),
    document_checklist: DocumentChecklistSchema.optional(),
    sla_config: SlaConfigSchema.optional(),
    eligibility_mapping: EligibilityMappingSchema.optional(),
    pan_required_at: z
      .enum(PAN_TIMING_VALUES, {
        errorMap: () => ({ message: 'pan_required_at must be one of: at_capture, before_kyc, before_handoff' }),
      })
      .optional(),
    status: z
      .literal(ConfigStatus.RETIRED, {
        errorMap: () => ({ message: "status via PATCH may only be 'retired'" }),
      })
      .optional(),
  })
  .superRefine((dto, ctx) => {
    // At least one mutable field must be present.
    if (Object.keys(dto).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'at least one field must be provided',
      });
      return;
    }
    // Only cross-validate at the DTO boundary when a field_schema is supplied;
    // otherwise the service validates against the merged (existing) schema.
    if (dto.field_schema != null) {
      crossValidateEligibilityMapping(dto.field_schema, dto.eligibility_mapping, ctx);
    }
  });

export type UpdateProductConfigDto = z.infer<typeof UpdateProductConfigDto>;
