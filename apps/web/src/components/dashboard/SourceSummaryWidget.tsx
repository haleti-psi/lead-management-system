import type { ReactElement } from 'react';
import { BarChart2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { SourceSummaryRow, WidgetError } from '@/hooks/use-dashboard';
import { EmptyState } from '@/components/common/EmptyState';
import { WidgetErrorState } from './WidgetErrorState';
import { cn } from '@/lib/utils';

/**
 * FR-053 — Source summary widget: top sources (last 30 days) by captured leads.
 * Renders a dependency-free SVG donut of capture share plus the canonical
 * low-bandwidth `<table>` (full detail incl. handed-off). Visible for BM/SM/HEAD.
 */
export interface SourceSummaryWidgetProps {
  rows: SourceSummaryRow[] | null;
  widgetError: WidgetError | undefined;
  visible: boolean;
  onRetry?: () => void;
}

/** Distinct, theme-aware slice colours (token / semantic — never hardcoded hex). */
const SLICE_COLORS = [
  'text-primary',
  'text-brand-2',
  'text-brand-3',
  'text-emerald-500',
  'text-amber-500',
] as const;

/** SVG donut of capture share by source + a colour-keyed legend. */
function SourceDonut({ rows }: { rows: SourceSummaryRow[] }): ReactElement {
  const slices = rows.map((r, i) => ({
    label: r.source_name,
    value: r.captured,
    color: SLICE_COLORS[i % SLICE_COLORS.length],
  }));
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const circumference = 2 * Math.PI * 42;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Capture share by source">
          <circle cx="50" cy="50" r="42" fill="none" strokeWidth="12" stroke="currentColor" className="text-muted" />
          {total > 0
            ? slices.map((s) => {
                const len = (s.value / total) * circumference;
                const node = (
                  <circle
                    key={s.label}
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="12"
                    stroke="currentColor"
                    className={s.color}
                    strokeDasharray={`${len} ${circumference - len}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += len;
                return node;
              })
            : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold leading-none tabular-nums">{total}</span>
          <span className="text-[10px] text-muted-foreground">captured</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span className={cn('h-2 w-2 shrink-0 rounded-full bg-current', s.color)} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{s.value}</span>
            <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SourceSummaryWidget({
  rows,
  widgetError,
  visible,
  onRetry,
}: SourceSummaryWidgetProps): ReactElement | null {
  if (!visible) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <BarChart2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-sm font-semibold">Source Summary (last 30 days)</CardTitle>
      </CardHeader>
      <CardContent>
        {widgetError ? (
          <WidgetErrorState widgetName="source_summary" onRetry={onRetry} />
        ) : rows === null || rows.length === 0 ? (
          <EmptyState title="No source data yet." />
        ) : (
          <div className="space-y-4">
            <SourceDonut rows={rows} />
            <table className="w-full text-sm" aria-label="Source summary">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">Source</th>
                  <th className="pb-1 text-right font-medium">Captured</th>
                  <th className="pb-1 text-right font-medium">Handed off</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.source_name} className="py-1">
                    <td className="py-1 pr-2">{row.source_name}</td>
                    <td className="py-1 text-right tabular-nums">{row.captured}</td>
                    <td className="py-1 text-right tabular-nums">{row.handed_off}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
