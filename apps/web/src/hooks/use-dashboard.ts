import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { apiClient } from '@/lib/api';
import { isApiClientError } from '@/lib/api';

/**
 * FR-053 — Dashboard API response types. Mirror the backend DashboardPayload DTO
 * exactly; any divergence between frontend and backend must be reconciled via the
 * api-contract.yaml.
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

export interface DashboardData {
  role: string;
  scope: { branch_id?: string; branch_name?: string; team_id?: string };
  generated_at: string;
  cache_hit: boolean;
  widgets: DashboardWidgets;
}

/**
 * FR-053 — TanStack Query hook for the dashboard endpoint. `staleTime: 55_000`
 * keeps data fresh just under the 60 s Redis cache TTL; `refetchInterval: 60_000`
 * auto-refreshes on the same cadence. On a 403 the hook navigates to `/forbidden`.
 */
export function useDashboard(): {
  data: DashboardData | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: async (): Promise<DashboardData> => {
      return apiClient.get<DashboardData>('/dashboard');
    },
    staleTime: 55_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => {
      if (isApiClientError(error) && error.status === 403) return false;
      return failureCount < 2;
    },
  });

  // 403 → navigate to forbidden page (no break-glass for PARTNER/CUSTOMER/ADMIN)
  if (query.error && isApiClientError(query.error) && query.error.status === 403) {
    navigate('/forbidden');
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
