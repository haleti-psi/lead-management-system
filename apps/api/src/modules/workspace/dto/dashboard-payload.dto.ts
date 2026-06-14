import type { RoleCode } from '@lms/shared';

/**
 * FR-053 — Dashboard API response shape. Mirrors the LLD §Endpoint response
 * exactly. Each widget field may be `null` when query-level degradation occurs
 * (Promise.allSettled); the sentinel + widget_errors entry pair carry the error.
 */

export interface KpiWidget {
  active_pipeline: number;
  captured_today: number;
  hot_leads: number;
  sla_breached: number;
  consent_coverage_pct: number;
  handed_off_this_month: number;
}

export interface SlaAlertRow {
  lead_id: string;
  lead_code: string;
  stage: string;
  owner_id: string;
  owner_name: string;
  sla_due_at: string;
  minutes_overdue: number;
}

export interface HotLeadRow {
  lead_id: string;
  lead_code: string;
  stage: string;
  name_masked: string;
  mobile_masked: string;
  score: number | null;
  owner_name: string;
}

export interface TaskRow {
  task_id: string;
  type: string;
  due_at: string;
  priority: string;
  lead_code: string;
  status: string;
}

export interface SourceSummaryRow {
  source_name: string;
  captured: number;
  handed_off: number;
}

export interface HandoffFailureEntry {
  lead_id: string;
  lead_code: string;
  last_attempt_at: string;
}

export interface HandoffFailureWidget {
  count: number;
  leads: HandoffFailureEntry[];
}

export interface WidgetError {
  widget: string;
  error_code: string;
  message: string;
}

export interface DashboardWidgets {
  kpi: KpiWidget | null;
  sla_alerts: SlaAlertRow[] | null;
  hot_leads: HotLeadRow[] | null;
  my_tasks: TaskRow[] | null;
  source_summary: SourceSummaryRow[] | null;
  handoff_failures: HandoffFailureWidget | null;
  widget_errors: WidgetError[];
}

export interface DashboardScopeInfo {
  branch_id?: string;
  branch_name?: string;
  team_id?: string;
}

export interface DashboardPayload {
  role: RoleCode;
  scope: DashboardScopeInfo;
  generated_at: string;
  cache_hit: boolean;
  widgets: DashboardWidgets;
}
