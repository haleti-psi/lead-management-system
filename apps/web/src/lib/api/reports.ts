import { apiClient } from './apiClient';
import type { QueryParams } from './apiClient';

/**
 * FR-120 — typed API client wrapper for `GET /api/v1/reports/{code}`.
 * Mirrors the backend `ReportData` shape (LLD §Success response).
 */

export type ReportCode =
  | 'funnel_conversion'
  | 'source_performance'
  | 'rm_performance'
  | 'rejection_summary';

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

export type ReportRow =
  | FunnelConversionRow
  | SourcePerformanceRow
  | RmPerformanceRow
  | RejectionSummaryRow;

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
