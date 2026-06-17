import type { ReactElement } from 'react';

import type {
  FunnelConversionRow,
  ReportCode,
  ReportRow,
  SourcePerformanceRow,
} from '@/lib/api/reports';

/**
 * FR-120 — lightweight, dependency-free report visualisations (CSS bars) shown
 * above the detail table for the chartable report codes. No chart library is in
 * the dependency register, so these are pure Tailwind + a single inline width %
 * (the only value that must be data-driven). The table below remains the
 * low-bandwidth / full-detail fallback. Non-chartable codes render nothing.
 */
export function ReportChart({ code, rows }: { code: ReportCode; rows: ReportRow[] }): ReactElement | null {
  if (rows.length === 0) return null;
  if (code === 'funnel_conversion') return <FunnelChart rows={rows as FunnelConversionRow[]} />;
  if (code === 'source_performance') return <SourceBars rows={rows as SourcePerformanceRow[]} />;
  return null;
}

const FUNNEL_STAGES: ReadonlyArray<{ key: keyof FunnelConversionRow; label: string }> = [
  { key: 'captured', label: 'Captured' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'documents_pending', label: 'Documents' },
  { key: 'kyc_in_progress', label: 'KYC' },
  { key: 'handed_off', label: 'Handed off' },
];

/** One horizontal bar row (label · proportional fill · value · optional badge). */
function Bar({
  label,
  value,
  pctOfMax,
  badge,
}: {
  label: string;
  value: number;
  pctOfMax: number;
  badge?: string;
}): ReactElement {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="relative h-6 flex-1 overflow-hidden rounded bg-muted">
        <div className="h-full rounded bg-primary/25" style={{ width: `${Math.max(2, pctOfMax)}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right font-medium tabular-nums">{value}</span>
      {badge !== undefined ? (
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{badge}</span>
      ) : null}
    </li>
  );
}

/** Org-wide conversion funnel — stage totals aggregated across the report rows. */
function FunnelChart({ rows }: { rows: FunnelConversionRow[] }): ReactElement {
  const totals = FUNNEL_STAGES.map((s) => ({
    label: s.label,
    count: rows.reduce((sum, r) => sum + (Number(r[s.key]) || 0), 0),
  }));
  const captured = totals[0]?.count ?? 0;
  const max = Math.max(1, ...totals.map((t) => t.count));
  return (
    <section aria-label="Conversion funnel" className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Conversion funnel</h2>
      <ol className="space-y-2">
        {totals.map((t) => (
          <Bar
            key={t.label}
            label={t.label}
            value={t.count}
            pctOfMax={(t.count / max) * 100}
            badge={captured > 0 ? `${Math.round((t.count / captured) * 100)}%` : '–'}
          />
        ))}
      </ol>
    </section>
  );
}

/** Captured-by-source bars (descending), with the handed-off conversion % badge. */
function SourceBars({ rows }: { rows: SourcePerformanceRow[] }): ReactElement {
  const sorted = [...rows].sort((a, b) => b.captured - a.captured);
  const max = Math.max(1, ...sorted.map((r) => r.captured));
  return (
    <section aria-label="Source performance" className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Captured by source</h2>
      <ol className="space-y-2">
        {sorted.map((r) => (
          <Bar
            key={r.source}
            label={r.source}
            value={r.captured}
            pctOfMax={(r.captured / max) * 100}
            badge={r.source_conversion_pct === '–' ? '–' : `${r.source_conversion_pct}%`}
          />
        ))}
      </ol>
    </section>
  );
}
