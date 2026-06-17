import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

import { useAuth } from '@/hooks/use-auth';
import type { DashboardData, WidgetError } from '@/hooks/use-dashboard';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiCardRow } from './KpiCardRow';
import { SlaAlertWidget } from './SlaAlertWidget';
import { HotLeadsWidget } from './HotLeadsWidget';
import { MyTasksWidget } from './MyTasksWidget';
import { SourceSummaryWidget } from './SourceSummaryWidget';
import { HandoffFailureWidget } from './HandoffFailureWidget';
import { PipelineTrendsWidget } from './PipelineTrendsWidget';

/**
 * FR-053 — Orchestrates the dashboard widget layout.
 *
 * Role → widget visibility:
 *   KPI cards:           RM, BM, SM, HEAD, KYC (all, with different scope)
 *   SLA alerts:          RM, BM, SM, HEAD, KYC
 *   Hot leads:           RM, BM, SM, HEAD (NOT KYC)
 *   My tasks:            RM, BM, SM, KYC (NOT HEAD)
 *   Source summary:      BM, SM, HEAD (NOT RM, NOT KYC)
 *   Hand-off failures:   BM, SM, HEAD (NOT RM, NOT KYC)
 */
export interface DashboardGridProps {
  data: DashboardData | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

/** Resolves which widgets are visible for a given role. */
function useWidgetVisibility(role: string) {
  return {
    hotLeads: role !== 'KYC',
    myTasks: role !== 'HEAD',
    sourceSummary: role === 'BM' || role === 'SM' || role === 'HEAD',
    handoffFailures: role === 'BM' || role === 'SM' || role === 'HEAD',
  };
}

/** Returns the widget error for a given widget name (or undefined). */
function findWidgetError(errors: WidgetError[], name: string): WidgetError | undefined {
  return errors.find((e) => e.widget === name);
}

export function DashboardGrid({ data, isLoading, isError, onRetry }: DashboardGridProps): ReactElement {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const visibility = useWidgetVisibility(role);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <LoadingSkeleton rows={2} />
            </div>
          ))}
        </div>
        <LoadingSkeleton rows={4} />
        <LoadingSkeleton rows={4} />
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState title="Dashboard unavailable" message="Please try again." onRetry={onRetry} />;
  }

  const { widgets } = data;
  const errors = widgets.widget_errors;

  // Full empty state: all KPI counts are zero and no widget-level errors
  const allEmpty =
    !widgets.kpi ||
    (widgets.kpi.active_pipeline === 0 &&
      widgets.kpi.captured_today === 0 &&
      widgets.kpi.hot_leads === 0);

  if (allEmpty && errors.length === 0) {
    return (
      <EmptyState
        title="Welcome, set up your first lead to get started"
        message="Your dashboard will populate as your team captures and works leads."
        action={
          <Button asChild>
            <Link to="/leads/new">Capture a lead</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI Cards (full-width strip) */}
      {widgets.kpi ? (
        <KpiCardRow kpi={widgets.kpi} />
      ) : findWidgetError(errors, 'kpi') ? (
        <div className="text-sm text-destructive">KPI data temporarily unavailable.</div>
      ) : null}

      {/* Secondary widgets — responsive 2-column grid (role-hidden widgets
          return null and simply take no cell). SLA alerts span the full width
          as the priority strip. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Pipeline value + captures trend — lead-viewing roles (scoped server-side) */}
        {role !== 'KYC' ? (
          <div className="lg:col-span-2">
            <PipelineTrendsWidget />
          </div>
        ) : null}

        {/* SLA Alerts — all roles */}
        <div className="lg:col-span-2">
          <SlaAlertWidget
            rows={widgets.sla_alerts}
            widgetError={findWidgetError(errors, 'sla_alerts')}
            onRetry={onRetry}
          />
        </div>

        {/* Hot Leads — not KYC */}
        <HotLeadsWidget
          rows={widgets.hot_leads}
          widgetError={findWidgetError(errors, 'hot_leads')}
          visible={visibility.hotLeads}
          onRetry={onRetry}
        />

        {/* My Tasks — not HEAD */}
        <MyTasksWidget
          rows={widgets.my_tasks}
          widgetError={findWidgetError(errors, 'my_tasks')}
          visible={visibility.myTasks}
          onRetry={onRetry}
        />

        {/* Source Summary — BM, SM, HEAD */}
        <SourceSummaryWidget
          rows={widgets.source_summary}
          widgetError={findWidgetError(errors, 'source_summary')}
          visible={visibility.sourceSummary}
          onRetry={onRetry}
        />

        {/* Hand-off Failures — BM, SM, HEAD */}
        <HandoffFailureWidget
          data={widgets.handoff_failures}
          widgetError={findWidgetError(errors, 'handoff_failures')}
          visible={visibility.handoffFailures}
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}
