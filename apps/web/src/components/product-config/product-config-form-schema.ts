import { z } from 'zod';
import {
  ApplicantScope,
  DocType,
  PanTiming,
  ProductCode,
} from '@lms/shared';
import { FIELD_TYPES } from '@/types/product-config';

/**
 * FR-040 — client-side Zod mirror of the NestJS product-config DTOs
 * (create-product-config.dto / product-config-schema). It pre-validates the form
 * before submit so the user gets inline messages without a round-trip; the server
 * remains authoritative (its identical schema runs again, and any
 * `VALIDATION_ERROR.fields[]` it returns is surfaced too). Messages are kept close
 * to the backend's wording for consistency.
 */

const PRODUCT_CODE_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];
const PAN_TIMING_VALUES = Object.values(PanTiming) as [PanTiming, ...PanTiming[]];
const DOC_TYPE_VALUES = Object.values(DocType) as [DocType, ...DocType[]];
const APPLICANT_SCOPE_VALUES = Object.values(ApplicantScope) as [ApplicantScope, ...ApplicantScope[]];

const fieldSchemaField = z
  .object({
    key: z
      .string()
      .min(1, 'Field key is required.')
      .regex(/^\S+$/, 'Field key must not contain spaces.'),
    label: z.string().min(1, 'Field label is required.'),
    type: z.enum(FIELD_TYPES, {
      errorMap: () => ({ message: 'Type must be one of text/number/date/select/boolean/file.' }),
    }),
    mandatory: z.boolean(),
    options: z.array(z.string().min(1)).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'select' && (field.options == null || field.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'A select field needs at least one option.',
      });
    }
  });

const fieldSchemaGroup = z.object({
  id: z.string().min(1, 'Group id is required.'),
  label: z.string().min(1, 'Group label is required.'),
  fields: z.array(fieldSchemaField).min(1, 'Each group needs at least one field.'),
});

export const fieldSchema = z.object({
  groups: z.array(fieldSchemaGroup).min(1, 'Add at least one field group.'),
});

const checklistItem = z.object({
  doc_type: z.enum(DOC_TYPE_VALUES, {
    errorMap: () => ({ message: 'Choose a valid document type.' }),
  }),
  mandatory: z.boolean(),
  applicant_scope: z.enum(APPLICANT_SCOPE_VALUES, {
    errorMap: () => ({ message: 'Choose a valid applicant scope.' }),
  }),
});

export const documentChecklist = z.object({
  items: z.array(checklistItem).min(1, 'Add at least one document.'),
});

const eligibilityMappingField = z.object({
  lms_field: z.string().min(1, 'LMS field is required.'),
  los_field: z.string().min(1, 'LOS field is required.'),
});

export const eligibilityMapping = z.object({
  fields: z.array(eligibilityMappingField),
});

/**
 * The full create payload schema. `sla_config` is validated separately from the
 * raw editor rows (see {@link slaRowsSchema}) so the positive-integer-hours rule
 * lands on the right row. The eligibility cross-field rule (every `lms_field` must
 * be a declared `field_schema` key) is enforced here, matching the backend.
 */
export const createProductConfigSchema = z
  .object({
    product_code: z.enum(PRODUCT_CODE_VALUES, {
      errorMap: () => ({ message: 'Select a product code.' }),
    }),
    name: z.string().min(1, 'Name is required.').max(120, 'Name must be 1–120 characters.'),
    field_schema: fieldSchema,
    document_checklist: documentChecklist,
    sla_config: z.record(z.number().int().positive('SLA hours must be a positive integer.')).optional(),
    eligibility_mapping: eligibilityMapping.optional(),
    pan_required_at: z.enum(PAN_TIMING_VALUES, {
      errorMap: () => ({ message: 'Select when PAN is required.' }),
    }),
  })
  .superRefine((dto, ctx) => {
    if (dto.eligibility_mapping == null) return;
    const declared = new Set<string>();
    for (const group of dto.field_schema.groups) {
      for (const field of group.fields) declared.add(field.key);
    }
    dto.eligibility_mapping.fields.forEach((mapping, index) => {
      if (!declared.has(mapping.lms_field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['eligibility_mapping', 'fields', index, 'lms_field'],
          message: `'${mapping.lms_field}' is not declared in the field schema.`,
        });
      }
    });
  });

export type CreateProductConfigValues = z.infer<typeof createProductConfigSchema>;

export const DOC_TYPE_OPTIONS = DOC_TYPE_VALUES.map((v) => ({ value: v, label: v }));
export const APPLICANT_SCOPE_OPTIONS = APPLICANT_SCOPE_VALUES.map((v) => ({ value: v, label: v }));
export const PRODUCT_CODE_OPTIONS = PRODUCT_CODE_VALUES.map((v) => ({ value: v, label: v }));
export const FIELD_TYPE_OPTIONS = FIELD_TYPES.map((v) => ({ value: v, label: v }));
export const PAN_TIMING_OPTIONS: ReadonlyArray<{ value: PanTiming; label: string }> = [
  { value: PanTiming.AT_CAPTURE, label: 'At capture' },
  { value: PanTiming.BEFORE_KYC, label: 'Before KYC' },
  { value: PanTiming.BEFORE_HANDOFF, label: 'Before handoff' },
];
