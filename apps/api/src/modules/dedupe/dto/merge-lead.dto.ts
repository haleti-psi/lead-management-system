import { z } from 'zod';

/**
 * FR-021 — `POST /leads/{id}/merge` request body (LLD §Validation Logic).
 * Validated at the controller boundary by `ZodValidationPipe`; failures map to
 * `VALIDATION_ERROR` (400) with field-level issues. The `master_lead_id ≠
 * path {id}` refinement needs the path parameter, so it is enforced as the
 * service's first check (same 400 + `fields[]` shape).
 */
const ManualOverrides = z.object({
  owner_id: z
    .string({ invalid_type_error: 'owner_id must be a valid UUID when field_precedence is manual' })
    .uuid('owner_id must be a valid UUID when field_precedence is manual')
    .nullable()
    .optional(),
  branch_id: z
    .string({ invalid_type_error: 'branch_id must be a valid UUID when provided' })
    .uuid('branch_id must be a valid UUID when provided')
    .nullable()
    .optional(),
});

export const FieldPrecedence = z.enum(['master', 'duplicate', 'manual'], {
  errorMap: () => ({ message: 'field_precedence must be one of: master, duplicate, manual' }),
});
export type FieldPrecedence = z.infer<typeof FieldPrecedence>;

export const MergeLeadDto = z
  .object({
    master_lead_id: z
      .string({ required_error: 'master_lead_id must be a valid UUID' })
      .uuid('master_lead_id must be a valid UUID'),
    reason: z
      .string({ required_error: 'Reason is required (max 500 characters)' })
      .min(1, 'Reason is required (max 500 characters)')
      .max(500, 'Reason is required (max 500 characters)'),
    field_precedence: FieldPrecedence,
    manual_overrides: ManualOverrides.optional(),
    expected_version: z
      .number({ required_error: 'expected_version must be a positive integer' })
      .int('expected_version must be a positive integer')
      .positive('expected_version must be a positive integer'),
  })
  .superRefine((value, ctx) => {
    // LLD: manual_overrides.owner_id is REQUIRED when field_precedence=manual (T-005).
    if (value.field_precedence === 'manual' && value.manual_overrides?.owner_id == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manual_overrides', 'owner_id'],
        message: 'owner_id must be a valid UUID when field_precedence is manual',
      });
    }
  });
export type MergeLeadDto = z.infer<typeof MergeLeadDto>;

/** `POST /leads/{id}/merge` 200 response `data` (LLD §Endpoints). */
export interface MergeLeadResponseDto {
  master_lead_id: string;
  duplicate_lead_id: string;
  merge_completed_at: string;
  attribution_records_relinked: number;
  documents_relinked: number;
  consent_records_relinked: number;
  tasks_relinked: number;
  duplicate_match_resolved: boolean;
  unmerge_allowed_until: string | null;
}
