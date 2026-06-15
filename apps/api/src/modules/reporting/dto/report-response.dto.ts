import type { ReportCode } from '../reporting.constants';

/**
 * FR-120 — typed row shapes per report code. Every percentage field is either
 * a one-decimal string (e.g. `"30.5"`) or `"–"` when the denominator is zero
 * (LLD §Backend Flow step 8; BRD §12.5 zero-denominator rule).
 */

/** Scope summary included in every report response. */
export interface ReportScope {
  branch_id: string | null;
  team_id: string | null;
  owner_id: string | null;
}

/** Period bounds included in every report response. */
export interface ReportPeriod {
  from: string | null;
  to: string | null;
}

// ── funnel_conversion ───────────────────────────────────────────────────────

export interface FunnelConversionRow {
  dimension: string; // product_code
  captured: number;
  assigned: number;
  contacted: number;
  qualified: number;
  documents_pending: number;
  kyc_in_progress: number;
  handed_off: number;
  rejected: number;
  active_pipeline: number;
  overall_conversion_pct: string; // "30.5" | "–"
  kyc_conversion_pct: string;     // "68.8" | "–"
}

// ── source_performance ──────────────────────────────────────────────────────

export interface SourcePerformanceRow {
  source: string;
  captured: number;
  handed_off: number;
  source_conversion_pct: string; // "–" when captured=0
}

// ── rm_performance ──────────────────────────────────────────────────────────

export interface RmPerformanceRow {
  owner_id: string;
  owner_name: string;
  captured: number;
  contacted: number;
  qualified: number;
  handed_off: number;
  rejected: number;
  rejection_rate_pct: string; // "–" when captured=0
}

// ── rejection_summary ───────────────────────────────────────────────────────

export interface RejectionSummaryRow {
  primary_reason: string;
  sub_reason: string | null;
  rejected_count: number;
}

// ── first_contact_sla ───────────────────────────────────────────────────────

export interface FirstContactSlaSummary {
  total_leads_in_scope: number;
  contacted_in_sla: number;
  sla_breached: number;
  pending_first_contact: number;
  sla_compliance_pct: string; // "–" when denominator = 0
}

export interface FirstContactSlaRow {
  branch_id: string;
  branch_name: string;
  total: number;
  contacted: number;
  breached: number;
  compliance_pct: string; // "–" when total - pending = 0
}

// ── kyc_doc_ageing ──────────────────────────────────────────────────────────

export interface KycDocAgeingRow {
  doc_type: string;
  product_code: string;
  avg_age_days: string; // decimal string
  doc_count: number;
  verified_count: number;
  pending_count: number;
}

// ── dsa_dealer_quality ──────────────────────────────────────────────────────

export interface DsaDealerQualityRow {
  partner_id: string;
  legal_name: string;
  type: string;
  quality_score: number | null;
  insufficient_data: boolean;
  metrics: Record<string, unknown>;
}

// ── duplicate_leakage ───────────────────────────────────────────────────────

export interface DuplicateLeakageRow {
  source: string;
  partner_id: string | null;
  confidence: string;
  action: string;
  status: string;
  count: number;
}

// ── handoff_failure ─────────────────────────────────────────────────────────

export interface HandoffFailureRow {
  integration: string;
  error_code: string | null;
  http_status: number | null;
  failure_count: number;
  avg_retries: string; // decimal string
  last_seen_at: string; // ISO
}

// ── source_roi ──────────────────────────────────────────────────────────────

export interface SourceRoiRow {
  source: string;
  campaign_code: string | null;
  partner_id: string | null;
  total_leads: number;
  converted: number;
  rejected: number;
  conversion_rate_pct: string; // "–" when total = 0
  cost_data_available: false;
}

// ── contactability ──────────────────────────────────────────────────────────

export interface ContactabilityRow {
  source: string;
  partner_id: string | null;
  channel: string;
  failure_reason: string | null;
  total_attempts: number;
  delivered: number;
  failed: number;
  contactability_rate_pct: string; // "–" when total = 0
}

// ── consent_privacy_ops ─────────────────────────────────────────────────────

export interface ConsentStatusCount {
  consent_status: string;
  product_code: string;
  count: number;
}

export interface DataRightsRequestCount {
  request_type: string;
  open_count: number;
}

export interface GrievanceCount {
  category: string;
  open_count: number;
}

export interface ConsentPrivacyOpsRow {
  type: 'consent_status' | 'data_rights_request' | 'grievance';
  data: ConsentStatusCount | DataRightsRequestCount | GrievanceCount;
}

// ── product_branch_heatmap ──────────────────────────────────────────────────

export interface ProductBranchHeatmapRow {
  product_code: string;
  branch_id: string;
  branch_name: string;
  volume: number;
  converted: number;
  rejected: number;
  conversion_rate_pct: string; // "–" when volume = 0
  avg_tat_hrs: string | null;  // null when no stage_history rows
}

// ── rm_capacity_load ────────────────────────────────────────────────────────

export interface RmCapacityLoadRow {
  user_id: string;
  full_name: string;
  branch_id: string;
  team_id: string | null;
  active_leads: number;
  early_stage_leads: number;
  open_tasks: number;
  overdue_tasks: number;
}

// ── union ───────────────────────────────────────────────────────────────────

export type ReportRow =
  | FunnelConversionRow
  | SourcePerformanceRow
  | RmPerformanceRow
  | RejectionSummaryRow
  // FR-121 differentiator rows
  | FirstContactSlaRow
  | KycDocAgeingRow
  | DsaDealerQualityRow
  | DuplicateLeakageRow
  | HandoffFailureRow
  | SourceRoiRow
  | ContactabilityRow
  | ConsentPrivacyOpsRow
  | ProductBranchHeatmapRow
  | RmCapacityLoadRow;

/** The `data` payload the controller returns for every report code. */
export interface ReportData<R extends ReportRow = ReportRow> {
  report_code: ReportCode;
  generated_at: string; // ISO 8601 with +05:30 suffix
  scope: ReportScope;
  period: ReportPeriod;
  rows: R[];
}
