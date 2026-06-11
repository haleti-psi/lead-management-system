import { z } from 'zod';

import { ApplicantScope, DocType, PanTiming, ProductCode } from '@lms/shared';

/**
 * FR-040 — shared Zod building blocks for the product-config payload (LLD
 * §Validation Logic). The `field_schema`, `document_checklist`, `sla_config`, and
 * `eligibility_mapping` structural rules are identical between Create and Update,
 * so they live here and are composed by both DTOs. Validation runs at the
 * controller boundary via {@link ZodValidationPipe}; every failure becomes
 * `VALIDATION_ERROR` (400) with field-level issues whose `path` mirrors the JSON
 * body (e.g. `field_schema.groups.0.fields.1.type`).
 */

const PRODUCT_CODE_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];
const PAN_TIMING_VALUES = Object.values(PanTiming) as [PanTiming, ...PanTiming[]];
const DOC_TYPE_VALUES = Object.values(DocType) as [DocType, ...DocType[]];
const APPLICANT_SCOPE_VALUES = Object.values(ApplicantScope) as [ApplicantScope, ...ApplicantScope[]];

const FIELD_TYPE_VALUES = ['text', 'number', 'date', 'select', 'boolean', 'file'] as const;

/** A single field inside a `field_schema` group. */
export const FieldSchemaFieldSchema = z
  .object({
    key: z
      .string({ required_error: 'field key is required' })
      .min(1, 'field key is required')
      .regex(/^\S+$/, 'field key must not contain spaces'),
    label: z.string({ required_error: 'field label is required' }).min(1, 'field label is required'),
    type: z.enum(FIELD_TYPE_VALUES, {
      errorMap: () => ({ message: 'type must be one of text/number/date/select/boolean/file' }),
    }),
    mandatory: z.boolean({ required_error: 'mandatory must be a boolean' }),
    options: z.array(z.string()).optional(),
  })
  .superRefine((field, ctx) => {
    // A select field must declare a non-empty options array.
    if (field.type === 'select' && (field.options == null || field.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'options must be a non-empty array when type is select',
      });
    }
  });

/** A group of fields in the capture form. */
export const FieldSchemaGroupSchema = z.object({
  id: z.string({ required_error: 'group id is required' }).min(1, 'group id is required'),
  label: z.string({ required_error: 'group label is required' }).min(1, 'group label is required'),
  fields: z.array(FieldSchemaFieldSchema).min(1, 'each group must declare at least one field'),
});

/** Full `field_schema` JSON. */
export const FieldSchemaSchema = z.object({
  groups: z.array(FieldSchemaGroupSchema).min(1, 'field_schema must contain at least one group'),
});
export type FieldSchema = z.infer<typeof FieldSchemaSchema>;

/** A single mandatory/optional document requirement. */
export const ChecklistItemSchema = z.object({
  doc_type: z.enum(DOC_TYPE_VALUES, {
    errorMap: () => ({ message: 'doc_type must be a valid document type' }),
  }),
  mandatory: z.boolean({ required_error: 'mandatory must be a boolean' }),
  applicant_scope: z.enum(APPLICANT_SCOPE_VALUES, {
    errorMap: () => ({ message: 'applicant_scope must be a valid applicant scope' }),
  }),
});

/** Full `document_checklist` JSON. */
export const DocumentChecklistSchema = z.object({
  items: z.array(ChecklistItemSchema).min(1, 'document_checklist must contain at least one item'),
});
export type DocumentChecklist = z.infer<typeof DocumentChecklistSchema>;

/**
 * `sla_config` JSON. Free-form keys, but every numeric value must be a positive
 * integer number of hours (LLD: "numeric hour values must be positive integers").
 */
export const SlaConfigSchema = z.record(z.unknown()).superRefine((cfg, ctx) => {
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value === 'number' && (!Number.isInteger(value) || value <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'sla_config values must be positive integers (hours)',
      });
    }
  }
});
export type SlaConfig = z.infer<typeof SlaConfigSchema>;

/** A single LMS→LOS field mapping row. */
export const EligibilityMappingFieldSchema = z.object({
  lms_field: z.string({ required_error: 'lms_field is required' }).min(1, 'lms_field is required'),
  los_field: z.string({ required_error: 'los_field is required' }).min(1, 'los_field is required'),
});

/** Full `eligibility_mapping` JSON. */
export const EligibilityMappingSchema = z.object({
  fields: z.array(EligibilityMappingFieldSchema),
});
export type EligibilityMapping = z.infer<typeof EligibilityMappingSchema>;

export {
  PRODUCT_CODE_VALUES,
  PAN_TIMING_VALUES,
  DOC_TYPE_VALUES,
  APPLICANT_SCOPE_VALUES,
  FIELD_TYPE_VALUES,
};
