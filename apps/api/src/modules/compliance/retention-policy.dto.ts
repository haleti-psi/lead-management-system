import { z } from 'zod';

import { DataCategory, LeadOutcome, RetentionAction } from '@lms/shared';

// ── Allowed enum values ────────────────────────────────────────────────────────

const dataCategoryValues = Object.values(DataCategory) as [string, ...string[]];
const leadOutcomeValues = Object.values(LeadOutcome) as [string, ...string[]];
const retentionActionValues = Object.values(RetentionAction) as [string, ...string[]];

// ── CreateRetentionPolicyDto ───────────────────────────────────────────────────

/**
 * DTO for POST /admin/retention-policies.
 * - `data_category === 'consent'` is rejected at the service layer.
 * - `retain_days` must be a non-negative integer.
 */
export const CreateRetentionPolicyDto = z.object({
  data_category: z
    .enum(dataCategoryValues as [DataCategory, ...DataCategory[]])
    .describe('data_category must be one of: ' + dataCategoryValues.join(', ')),
  lead_outcome: z
    .enum(leadOutcomeValues as [LeadOutcome, ...LeadOutcome[]])
    .optional()
    .describe('lead_outcome must be one of: ' + leadOutcomeValues.join(', ')),
  retain_days: z
    .number({ invalid_type_error: 'retain_days must be a non-negative integer' })
    .int('retain_days must be a non-negative integer')
    .min(0, 'retain_days must be a non-negative integer'),
  action: z
    .enum(retentionActionValues as [RetentionAction, ...RetentionAction[]])
    .describe('action must be purge or anonymise'),
  legal_hold: z.boolean().optional().default(false),
});

export type CreateRetentionPolicyDto = z.infer<typeof CreateRetentionPolicyDto>;

// ── RunRetentionDto ────────────────────────────────────────────────────────────

export const RetentionMode = {
  DRY_RUN: 'dry_run',
  APPLY: 'apply',
} as const;
export type RetentionMode = (typeof RetentionMode)[keyof typeof RetentionMode];

export const RunRetentionDto = z.object({
  mode: z.enum(['dry_run', 'apply'] as [RetentionMode, RetentionMode], {
    invalid_type_error: 'mode must be dry_run or apply',
    required_error: 'mode must be dry_run or apply',
  }),
  data_category: z
    .enum(dataCategoryValues as [DataCategory, ...DataCategory[]])
    .optional()
    .describe('data_category must be one of the permitted values'),
});

export type RunRetentionDto = z.infer<typeof RunRetentionDto>;

// ── RetentionPolicyDto (response shape) ───────────────────────────────────────

export interface RetentionPolicyDto {
  retention_policy_id: string;
  data_category: DataCategory;
  lead_outcome: LeadOutcome | null;
  retain_days: number;
  action: RetentionAction;
  legal_hold: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── DryRunPreview (response shape) ────────────────────────────────────────────

export interface DryRunCategoryCount {
  data_category: DataCategory;
  action: RetentionAction;
  count: number;
}

export interface DryRunPreview {
  eligible_leads: number;
  by_category: DryRunCategoryCount[];
  blocked_by_legal_hold: number;
  blocked_by_open_request: number;
}

// ── RunResponse ───────────────────────────────────────────────────────────────

export interface RetentionRunResponse {
  run_id: string;
  mode: RetentionMode;
  status: 'queued' | 'completed';
  preview: DryRunPreview | null;
}

// ── ListRetentionPoliciesQuery ─────────────────────────────────────────────────

export const ListRetentionPoliciesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  data_category: z
    .enum(dataCategoryValues as [DataCategory, ...DataCategory[]])
    .optional(),
  action: z
    .enum(retentionActionValues as [RetentionAction, ...RetentionAction[]])
    .optional(),
  is_active: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : v),
    z.boolean().optional(),
  ),
});

export type ListRetentionPoliciesQuery = z.infer<typeof ListRetentionPoliciesQuery>;
