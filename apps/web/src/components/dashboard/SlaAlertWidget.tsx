import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { SlaAlertRow, WidgetError } from '@/hooks/use-dashboard';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — SLA alert widget: shows top-10 most-overdue first_contact_pending
 * leads. Each row links to the Lead 360 view (FR-051). Visible for all roles.
 */
export interface SlaAlertWidgetProps {
  rows: SlaAlertRow[] | null;
  widgetError: WidgetError | undefined;
  onRetry?: () => void;
}

export function SlaAlertWidget({ rows, widgetError, onRetry }: SlaAlertWidgetProps): ReactElement {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
        <CardTitle className="text-sm font-semibold">SLA Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        {widgetError ? (
          <WidgetErrorState widgetName="sla_alerts" onRetry={onRetry} />
        ) : rows === null || rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No SLA breaches — well done!</p>
        ) : (
          <ul className="space-y-2" aria-label="SLA breached leads">
            {rows.map((row) => (
              <li key={row.lead_id} className="flex items-center justify-between gap-2 text-sm">
                <Link
                  to={`/leads/${row.lead_id}`}
                  className="font-medium text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.lead_code}
                </Link>
                <span className="text-muted-foreground">
                  {row.owner_name} &mdash; {Math.round(row.minutes_overdue)} min overdue
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
