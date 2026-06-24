import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { HotLeadRow, WidgetError } from '@/hooks/use-dashboard';
import { StatusChip } from '@/components/ui/StatusChip';
import { EmptyState } from '@/components/common/EmptyState';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — Hot leads widget: top-10 hot leads by score. Each row exposes only
 * `name_masked` and `mobile_masked` (PII-safe values from the API). Drill-through
 * to Lead 360 per lead. Hidden for KYC role (controlled via `visible` prop).
 */
export interface HotLeadsWidgetProps {
  rows: HotLeadRow[] | null;
  widgetError: WidgetError | undefined;
  visible: boolean;
  onRetry?: () => void;
}

export function HotLeadsWidget({
  rows,
  widgetError,
  visible,
  onRetry,
}: HotLeadsWidgetProps): ReactElement | null {
  if (!visible) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Flame className="h-4 w-4 text-orange-500" aria-hidden />
        <CardTitle className="text-sm font-semibold">Hot Leads</CardTitle>
      </CardHeader>
      <CardContent>
        {widgetError ? (
          <WidgetErrorState widgetName="hot_leads" onRetry={onRetry} />
        ) : rows === null || rows.length === 0 ? (
          <EmptyState title="No hot leads right now." />
        ) : (
          <ul className="space-y-2" aria-label="Hot leads">
            {rows.map((row) => (
              <li key={row.lead_id} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {/* PII: only masked values are exposed (name first, then code · mobile) */}
                  <Link
                    to={`/leads/${row.lead_id}`}
                    className="truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.name_masked}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{row.lead_code}</span>
                    {' · '}
                    {row.mobile_masked}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusChip status={row.stage} />
                  {row.score !== null ? (
                    <span className="text-xs font-semibold text-orange-600">
                      {row.score}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
