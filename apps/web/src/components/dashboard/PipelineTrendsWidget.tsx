import type { ReactElement } from 'react';
import { TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { usePipelineTrends, type CapturePoint } from '@/hooks/use-pipeline-trends';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — Pipeline activity widget. Shows the scoped active pipeline value
 * (compact INR) and an interactive 14-day daily-captures bar chart (no chart
 * dependency; low-bandwidth friendly). Each bar brightens and reveals a tooltip
 * on hover/focus. All four states handled.
 */
const INR_COMPACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const DAY_FMT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

function formatValue(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? INR_COMPACT.format(n) : '—';
}

function formatDay(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : DAY_FMT.format(d);
}

/** Interactive daily-captures bars; hover/focus brightens the bar + shows a tooltip. */
function CapturesBars({ series }: { series: CapturePoint[] }): ReactElement {
  if (series.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No captures in this period.</p>;
  }
  const max = Math.max(1, ...series.map((p) => p.count));
  return (
    <div className="flex h-20 items-end gap-1" role="img" aria-label="Daily captures over the last 14 days">
      {series.map((p, i) => (
        <div
          key={i}
          className="group relative flex h-full flex-1 items-end"
          title={`${formatDay(p.date)}: ${p.count} capture${p.count === 1 ? '' : 's'}`}
        >
          <div
            className="w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
            style={{ height: `${Math.max(3, (p.count / max) * 100)}%` }}
          />
          <span className="pointer-events-none absolute inset-x-0 -top-7 z-10 mx-auto hidden w-max max-w-[8rem] rounded-md bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-md group-hover:block">
            {formatDay(p.date)}: {p.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PipelineTrendsWidget(): ReactElement {
  const { data, isLoading, isError, refetch } = usePipelineTrends();
  const total = data ? data.captured_series.reduce((sum, p) => sum + p.count, 0) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-sm font-semibold">Pipeline activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : isError || !data ? (
          <WidgetErrorState widgetName="pipeline_trends" onRetry={refetch} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Active pipeline value</p>
                <p className="text-2xl font-bold leading-none tabular-nums">
                  {formatValue(data.pipeline_value)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Captures · 14 days</p>
                <p className="text-lg font-semibold leading-none tabular-nums">{total}</p>
              </div>
            </div>
            <CapturesBars series={data.captured_series} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
