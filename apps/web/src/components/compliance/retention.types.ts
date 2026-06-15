/**
 * FR-115 — Retention policy types for the web slice.
 * Mirrors the API contract shapes from docs/lld/FR-115.md §Endpoints.
 */

export type DataCategory =
  | 'identity'
  | 'contact'
  | 'financial'
  | 'kyc_doc'
  | 'asset'
  | 'consent'
  | 'behavioural';

export type RetentionAction = 'purge' | 'anonymise';

export type LeadOutcome = 'rejected' | 'handed_off' | 'dormant' | 'any';

export type RetentionMode = 'dry_run' | 'apply';

export interface RetentionPolicy {
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

export interface RetentionPolicyListResult {
  data: RetentionPolicy[];
  meta: {
    correlation_id: string;
    page: number;
    limit: number;
    total: number;
  };
  error: null;
}

export interface CreateRetentionPolicyInput {
  data_category: DataCategory;
  lead_outcome?: LeadOutcome;
  retain_days: number;
  action: RetentionAction;
  legal_hold?: boolean;
}

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

export interface RetentionRunResult {
  run_id: string;
  mode: RetentionMode;
  status: 'queued' | 'completed';
  preview: DryRunPreview | null;
}

export interface ListRetentionPoliciesParams {
  page?: number;
  limit?: number;
  data_category?: DataCategory;
  action?: RetentionAction;
  is_active?: boolean;
}

// ── Display labels ────────────────────────────────────────────────────────────

export const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  identity: 'Identity',
  contact: 'Contact',
  financial: 'Financial',
  kyc_doc: 'KYC Documents',
  asset: 'Asset',
  consent: 'Consent',
  behavioural: 'Behavioural',
};

export const RETENTION_ACTION_LABELS: Record<RetentionAction, string> = {
  purge: 'Purge',
  anonymise: 'Anonymise',
};

export const LEAD_OUTCOME_LABELS: Record<LeadOutcome, string> = {
  rejected: 'Rejected',
  handed_off: 'Handed Off',
  dormant: 'Dormant',
  any: 'Any outcome',
};
