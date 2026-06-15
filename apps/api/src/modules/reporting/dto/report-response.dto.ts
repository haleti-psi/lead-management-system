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

// ── union ───────────────────────────────────────────────────────────────────

export type ReportRow =
  | FunnelConversionRow
  | SourcePerformanceRow
  | RmPerformanceRow
  | RejectionSummaryRow;

/** The `data` payload the controller returns for every report code. */
export interface ReportData<R extends ReportRow = ReportRow> {
  report_code: ReportCode;
  generated_at: string; // ISO 8601 with +05:30 suffix
  scope: ReportScope;
  period: ReportPeriod;
  rows: R[];
}
