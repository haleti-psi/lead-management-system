import { z } from 'zod';

import {
  DocumentChecklistSchema,
  EligibilityMappingSchema,
  FieldSchemaSchema,
  PAN_TIMING_VALUES,
  PRODUCT_CODE_VALUES,
  SlaConfigSchema,
} from './product-config-schema';

/**
 * FR-040 — `POST /admin/products` request schema (LLD §Validation Logic ·
 * CreateProductConfigDto). Validated at the controller boundary by
 * {@link ZodValidationPipe}; any failure becomes `VALIDATION_ERROR` (400) with
 * field-level issues. The cross-field rule that every `eligibility_mapping`
 * `lms_field` must be declared in `field_schema` is enforced here via
 * `superRefine` so it surfaces under the exact mapping-row path the spec mandates
 * (`eligibility_mapping.fields.N.lms_field`).
 */
export const CreateProductConfigDto = z
  .object({
    product_code: z.enum(PRODUCT_CODE_VALUES, {
      errorMap: () => ({ message: 'product_code must be one of: CV, CAR, TRACTOR, CE, TW, SBL, HRM' }),
    }),
    name: z
      .string({ required_error: 'name is required and must be 1–120 characters' })
      .min(1, 'name is required and must be 1–120 characters')
      .max(120, 'name is required and must be 1–120 characters'),
    field_schema: FieldSchemaSchema,
    document_checklist: DocumentChecklistSchema,
    sla_config: SlaConfigSchema.optional(),
    eligibility_mapping: EligibilityMappingSchema.optional(),
    pan_required_at: z.enum(PAN_TIMING_VALUES, {
      errorMap: () => ({ message: 'pan_required_at must be one of: at_capture, before_kyc, before_handoff' }),
    }),
  })
  .superRefine((dto, ctx) => {
    crossValidateEligibilityMapping(dto.field_schema, dto.eligibility_mapping, ctx);
  });

export type CreateProductConfigDto = z.infer<typeof CreateProductConfigDto>;

/**
 * Shared cross-field check (reused by the Update DTO against the merged schema):
 * each `eligibility_mapping.fields[*].lms_field` must appear as a declared
 * `field_schema.groups[*].fields[*].key`.
 */
export function crossValidateEligibilityMapping(
  fieldSchema: z.infer<typeof FieldSchemaSchema> | undefined,
  eligibilityMapping: z.infer<typeof EligibilityMappingSchema> | undefined,
  ctx: z.RefinementCtx,
): void {
  if (eligibilityMapping == null || fieldSchema == null) return;
  const declaredKeys = new Set<string>();
  for (const group of fieldSchema.groups) {
    for (const field of group.fields) declaredKeys.add(field.key);
  }
  eligibilityMapping.fields.forEach((mapping, index) => {
    if (!declaredKeys.has(mapping.lms_field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eligibility_mapping', 'fields', index, 'lms_field'],
        message: `eligibility_mapping.fields[${index}].lms_field '${mapping.lms_field}' not declared in field_schema`,
      });
    }
  });
}
