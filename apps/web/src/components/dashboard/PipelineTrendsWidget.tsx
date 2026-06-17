import type { ReactElement } from 'react';
import { TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { usePipelineTrends, type CapturePoint } from '@/hooks/use-pipeline-trends';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — Pipeline value + captures-trend widget. Shows the scoped active
 * pipeline value (compact INR) and a 14-day daily captures sparkline (inline
 * SVG — no chart dependency). All four states handled. Visible to lead-viewing
 * roles (gated by the parent grid); the endpoint is scope-filtered server-side.
 */
const INR_COMPACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatValue(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? INR_COMPACT.format(n) : '—';
}

/** Inline SVG sparkline of daily counts (stretches to width; crisp stroke). */
function Sparkline({ series }: { series: CapturePoint[] }): ReactElement {
  const W = 240;
  const H = 40;
  const pad = 2;
  const max = Math.max(1, ...series.map((p) => p.count));
  const n = series.length;
  const points = series
    .map((p, i) => {
      const x = n <= 1 ? pad : (i / (n - 1)) * (W - pad * 2) + pad;
      const y = H - pad - (p.count / max) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-10 w-full text-primary"
      preserveAspectRatio="none"
      role="img"
      aria-label="Captures over the last 14 days"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function PipelineTrendsWidget(): ReactElement {
  const { data, isLoading, isError, refetch } = usePipelineTrends();
  const total = data ? data.captured_series.reduce((sum, p) => sum + p.count, 0) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-sm font-semibold">Pipeline &amp; captures</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : isError || !data ? (
          <WidgetErrorState widgetName="pipeline_trends" onRetry={refetch} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
            <div>
              <p className="text-xs text-muted-foreground">Active pipeline value</p>
              <p className="text-2xl font-bold leading-none tabular-nums">{formatValue(data.pipeline_value)}</p>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Captures · last 14 days</span>
                <span className="tabular-nums">{total}</span>
              </div>
              <Sparkline series={data.captured_series} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
