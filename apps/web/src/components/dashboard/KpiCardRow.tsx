import type { ReactElement } from 'react';
import { Activity, AlertTriangle, CheckCircle, Flame, PackageCheck, TrendingUp } from 'lucide-react';

import type { KpiWidget } from '@/hooks/use-dashboard';
import { KpiCard } from './KpiCard';

/**
 * FR-053 — Row of KPI cards. Each card links to the lead list with the
 * appropriate filter per the LLD §UI §Drill-through table.
 */
export interface KpiCardRowProps {
  kpi: KpiWidget;
}

export function KpiCardRow({ kpi }: KpiCardRowProps): ReactElement {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" role="region" aria-label="KPI summary">
      <KpiCard
        title="Active Pipeline"
        value={kpi.active_pipeline}
        icon={Activity}
        to="/leads?filter[stage][ne]=handed_off&filter[stage][ne]=rejected"
        description="Leads in progress"
      />
      <KpiCard
        title="Captured Today"
        value={kpi.captured_today}
        icon={TrendingUp}
        to="/leads?filter[sla_state]=none"
        description="New leads today"
      />
      <KpiCard
        title="Hot Leads"
        value={kpi.hot_leads}
        icon={Flame}
        to="/leads?filter[is_hot]=true"
        description="Score ≥ 75"
      />
      <KpiCard
        title="SLA Breached"
        value={kpi.sla_breached}
        icon={AlertTriangle}
        to="/leads?filter[stage]=first_contact_pending&filter[sla_breached]=true"
        description="Overdue first contact"
        alert
      />
      <KpiCard
        title="Consent Coverage"
        value={kpi.consent_coverage_pct}
        icon={CheckCircle}
        to="/leads?filter[consent_status]=pending"
        description="% with consent"
      />
      <KpiCard
        title="Handed Off"
        value={kpi.handed_off_this_month}
        icon={PackageCheck}
        to="/leads?filter[stage]=handed_off"
        description="This month"
      />
    </div>
  );
}
