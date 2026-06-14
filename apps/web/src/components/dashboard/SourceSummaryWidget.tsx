import type { ReactElement } from 'react';
import { BarChart2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { SourceSummaryRow, WidgetError } from '@/hooks/use-dashboard';
import { EmptyState } from '@/components/common/EmptyState';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — Source summary widget: top-5 sources last 30 days by captured leads.
 *
 * Low-bandwidth mode: renders a `<table>` only. MiniChart (bar) is omitted in
 * this implementation since no chart library is approved in dependency-register.md;
 * the table-only fallback is always the canonical low-bandwidth view per the LLD.
 * This is noted in AMBIGUITY.md (A-FR053-1).
 *
 * Visible for BM, SM, HEAD only (controlled via `visible` prop).
 */
export interface SourceSummaryWidgetProps {
  rows: SourceSummaryRow[] | null;
  widgetError: WidgetError | undefined;
  visible: boolean;
  onRetry?: () => void;
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
          <table className="w-full text-sm" aria-label="Source summary">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 font-medium">Source</th>
                <th className="pb-1 font-medium text-right">Captured</th>
                <th className="pb-1 font-medium text-right">Handed off</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.source_name} className="py-1">
                  <td className="py-1 pr-2">{row.source_name}</td>
                  <td className="py-1 text-right">{row.captured}</td>
                  <td className="py-1 text-right">{row.handed_off}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
