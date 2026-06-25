import type { ReactElement } from 'react';
import { TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { usePipelineTrends, type CapturePoint } from '@/hooks/use-pipeline-trends';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — Pipeline activity widget. Shows the scoped active pipeline value
 * (compact INR) and an interactive 14-day daily-captures bar chart with y-axis
 * gridlines, rounded gradient bars and per-bar hover tooltips. Dependency-free
 * (CSS + a single data-driven height %); low-bandwidth friendly. All states handled.
 */
const INR_COMPACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const DAY_FMT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const DOM_FMT = new Intl.DateTimeFormat('en-IN', { day: 'numeric' });

function formatValue(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? INR_COMPACT.format(n) : '—';
}

function formatDay(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : DAY_FMT.format(d);
}

function dayNum(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : DOM_FMT.format(d);
}

/** Interactive bar chart: gridlines + y-axis ticks + rounded gradient bars with
 * a hover tooltip per day. */
function CapturesChart({ series }: { series: CapturePoint[] }): ReactElement {
  if (series.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No captures in this period.</p>;
  }
  const max = Math.max(1, ...series.map((p) => p.count));
  const ticks = [max, Math.round(max / 2), 0];

  return (
    <div className="flex gap-3">
      {/* Y-axis tick labels */}
      <div className="flex h-48 w-7 shrink-0 flex-col justify-between text-right text-[10px] leading-none tabular-nums text-muted-foreground">
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-48">
          {/* Horizontal gridlines */}
          <div className="absolute inset-0 flex flex-col justify-between" aria-hidden>
            {ticks.map((_, i) => (
              <div key={i} className="h-px w-full bg-border/70" />
            ))}
          </div>
          {/* Bars */}
          <div
            className="absolute inset-0 flex items-end gap-1.5"
            role="img"
            aria-label="Daily captures over the last 14 days"
          >
            {series.map((p, i) => (
              <div
                key={i}
                className="group relative flex h-full flex-1 items-end"
                title={`${formatDay(p.date)}: ${p.count} capture${p.count === 1 ? '' : 's'}`}
              >
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-primary/60 to-primary shadow-sm transition-[filter] group-hover:brightness-110"
                  style={{ height: `${Math.max(2, (p.count / max) * 100)}%` }}
                />
                <span className="pointer-events-none absolute inset-x-0 -top-8 z-10 mx-auto hidden w-max max-w-[7rem] rounded-md bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-md group-hover:block">
                  {formatDay(p.date)} · {p.count}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* X-axis day labels */}
        <div className="mt-2 flex gap-1.5">
          {series.map((p, i) => (
            <span key={i} className="flex-1 truncate text-center text-[9px] tabular-nums text-muted-foreground">
              {dayNum(p.date)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PipelineTrendsWidget(): ReactElement {
  const { data, isLoading, isError, refetch } = usePipelineTrends();
  const total = data ? data.captured_series.reduce((sum, p) => sum + p.count, 0) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm font-semibold">Pipeline activity</CardTitle>
        </div>
        {!isLoading && !isError && data ? (
          <span className="text-xs text-muted-foreground">
            Captures · 14 days <span className="font-semibold tabular-nums text-foreground">{total}</span>
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : isError || !data ? (
          <WidgetErrorState widgetName="pipeline_trends" onRetry={refetch} />
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Active pipeline value</p>
              <p className="text-2xl font-bold leading-none tabular-nums">
                {formatValue(data.pipeline_value)}
              </p>
            </div>
            <CapturesChart series={data.captured_series} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
