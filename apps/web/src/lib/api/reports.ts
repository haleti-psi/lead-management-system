import { apiClient } from './apiClient';
import type { QueryParams } from './apiClient';

/**
 * FR-120 — typed API client wrapper for `GET /api/v1/reports/{code}`.
 * Mirrors the backend `ReportData` shape (LLD §Success response).
 */

export type ReportCode =
  // FR-120 core pack
  | 'funnel_conversion'
  | 'source_performance'
  | 'rm_performance'
  | 'rejection_summary'
  // FR-121 differentiator pack
  | 'first_contact_sla'
  | 'kyc_doc_ageing'
  | 'dsa_dealer_quality'
  | 'duplicate_leakage'
  | 'handoff_failure'
  | 'source_roi'
  | 'contactability'
  | 'consent_privacy_ops'
  | 'product_branch_heatmap'
  | 'rm_capacity_load';

export interface ReportScope {
  branch_id: string | null;
  team_id: string | null;
  owner_id: string | null;
}

export interface ReportPeriod {
  from: string | null;
  to: string | null;
}

export interface FunnelConversionRow {
  dimension: string;
  captured: number;
  assigned: number;
  contacted: number;
  qualified: number;
  documents_pending: number;
  kyc_in_progress: number;
  handed_off: number;
  rejected: number;
  active_pipeline: number;
  overall_conversion_pct: string;
  kyc_conversion_pct: string;
}

export interface SourcePerformanceRow {
  source: string;
  captured: number;
  handed_off: number;
  source_conversion_pct: string;
}

export interface RmPerformanceRow {
  owner_id: string;
  owner_name: string;
  captured: number;
  contacted: number;
  qualified: number;
  handed_off: number;
  rejected: number;
  rejection_rate_pct: string;
}

export interface RejectionSummaryRow {
  primary_reason: string;
  sub_reason: string | null;
  rejected_count: number;
}

// ── FR-121 differentiator row types ─────────────────────────────────────────

export interface FirstContactSlaRow {
  branch_id: string;
  branch_name: string;
  total: number;
  contacted: number;
  breached: number;
  compliance_pct: string;
}

export interface KycDocAgeingRow {
  doc_type: string;
  product_code: string;
  avg_age_days: string;
  doc_count: number;
  verified_count: number;
  pending_count: number;
}

export interface DsaDealerQualityRow {
  partner_id: string;
  legal_name: string;
  type: string;
  quality_score: number | null;
  insufficient_data: boolean;
  metrics: Record<string, unknown>;
}

export interface DuplicateLeakageRow {
  source: string;
  partner_id: string | null;
  confidence: string;
  action: string;
  status: string;
  count: number;
}

export interface HandoffFailureRow {
  integration: string;
  error_code: string | null;
  http_status: number | null;
  failure_count: number;
  avg_retries: string;
  last_seen_at: string;
}

export interface SourceRoiRow {
  source: string;
  campaign_code: string | null;
  partner_id: string | null;
  total_leads: number;
  converted: number;
  rejected: number;
  conversion_rate_pct: string;
  cost_data_available: false;
}

export interface ContactabilityRow {
  source: string;
  partner_id: string | null;
  channel: string;
  failure_reason: string | null;
  total_attempts: number;
  delivered: number;
  failed: number;
  contactability_rate_pct: string;
}

export interface ConsentPrivacyOpsRow {
  type: 'consent_status' | 'data_rights_request' | 'grievance';
  data: Record<string, unknown>;
}

export interface ProductBranchHeatmapRow {
  product_code: string;
  branch_id: string;
  branch_name: string;
  volume: number;
  converted: number;
  rejected: number;
  conversion_rate_pct: string;
  avg_tat_hrs: string | null;
}

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

export interface ReportData {
  report_code: ReportCode;
  generated_at: string;
  scope: ReportScope;
  period: ReportPeriod;
  rows: ReportRow[];
}

export interface ReportParams {
  from?: string;
  to?: string;
  branch_id?: string;
  team_id?: string;
  owner_id?: string;
  product_code?: string;
  source?: string;
  partner_id?: string;
  page?: number;
  limit?: number;
}

/** Result of {@link fetchReport}: report payload plus the envelope total. */
export interface FetchReportResult {
  data: ReportData;
  total: number;
}

/**
 * Fetches a report from `GET /api/v1/reports/{code}`.
 * Returns `{ data, total }` so callers can surface pagination totals.
 * Throws `ApiClientError` on error.
 */
export async function fetchReport(
  code: ReportCode,
  params: ReportParams = {},
  signal?: AbortSignal,
): Promise<FetchReportResult> {
  const query: QueryParams = {};
  if (params.from !== undefined) query['from'] = params.from;
  if (params.to !== undefined) query['to'] = params.to;
  if (params.branch_id !== undefined) query['branch_id'] = params.branch_id;
  if (params.team_id !== undefined) query['team_id'] = params.team_id;
  if (params.owner_id !== undefined) query['owner_id'] = params.owner_id;
  if (params.product_code !== undefined) query['product_code'] = params.product_code;
  if (params.source !== undefined) query['source'] = params.source;
  if (params.partner_id !== undefined) query['partner_id'] = params.partner_id;
  if (params.page !== undefined) query['page'] = params.page;
  if (params.limit !== undefined) query['limit'] = params.limit;

  const envelope = await apiClient.getEnvelope<ReportData>(`/reports/${code}`, { query, signal });
  if (envelope.data == null) {
    throw new Error('Report endpoint returned no data');
  }
  return {
    data: envelope.data,
    total: (envelope.meta as { pagination?: { total?: number } } | undefined)?.pagination?.total ?? 0,
  };
}
