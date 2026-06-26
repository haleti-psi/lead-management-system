import type { ReactElement } from 'react';

import type {
  FirstContactSlaRow,
  FunnelConversionRow,
  RejectionSummaryRow,
  ReportCode,
  ReportRow,
  RmPerformanceRow,
  SourcePerformanceRow,
  SourceRoiRow,
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
  if (code === 'rm_performance') return <RmBars rows={rows as RmPerformanceRow[]} />;
  if (code === 'rejection_summary') return <RejectionBars rows={rows as RejectionSummaryRow[]} />;
  if (code === 'first_contact_sla') return <SlaComplianceBars rows={rows as FirstContactSlaRow[]} />;
  if (code === 'source_roi') return <SourceRoiBars rows={rows as SourceRoiRow[]} />;
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
        <div className="h-full rounded bg-primary" style={{ width: `${Math.max(2, pctOfMax)}%` }} />
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

/** Handed-off-by-RM bars (descending) with the captured workload as context. */
function RmBars({ rows }: { rows: RmPerformanceRow[] }): ReactElement {
  const sorted = [...rows].sort((a, b) => b.handed_off - a.handed_off);
  const max = Math.max(1, ...sorted.map((r) => r.handed_off));
  return (
    <section aria-label="RM performance" className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Handed off by RM</h2>
      <ol className="space-y-2">
        {sorted.map((r) => (
          <Bar
            key={r.owner_id}
            label={r.owner_name}
            value={r.handed_off}
            pctOfMax={(r.handed_off / max) * 100}
            badge={`/${r.captured}`}
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

/** Rejections aggregated by primary reason (descending), with share-of-total badge. */
function RejectionBars({ rows }: { rows: RejectionSummaryRow[] }): ReactElement {
  const byReason = new Map<string, number>();
  for (const r of rows) {
    byReason.set(r.primary_reason, (byReason.get(r.primary_reason) ?? 0) + (Number(r.rejected_count) || 0));
  }
  const sorted = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...sorted.map(([, n]) => n));
  return (
    <section aria-label="Rejections by reason" className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Rejections by reason</h2>
      <ol className="space-y-2">
        {sorted.map(([reason, count]) => (
          <Bar
            key={reason}
            label={reason}
            value={count}
            pctOfMax={(count / max) * 100}
            badge={total > 0 ? `${Math.round((count / total) * 100)}%` : '–'}
          />
        ))}
      </ol>
    </section>
  );
}

/** First-contact SLA compliance by branch — bar fill is the compliance %, with
 * total leads as volume context and the exact % as the badge. */
function SlaComplianceBars({ rows }: { rows: FirstContactSlaRow[] }): ReactElement {
  const parsed = rows
    .map((r) => ({
      id: r.branch_id,
      label: r.branch_name,
      total: r.total,
      pct: r.compliance_pct === '–' ? null : Number(r.compliance_pct),
      raw: r.compliance_pct,
    }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  return (
    <section aria-label="First-contact SLA compliance" className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">First-contact SLA compliance</h2>
      <ol className="space-y-2">
        {parsed.map((r) => (
          <Bar
            key={r.id}
            label={r.label}
            value={r.total}
            pctOfMax={r.pct ?? 0}
            badge={r.pct === null ? '–' : `${r.raw}%`}
          />
        ))}
      </ol>
    </section>
  );
}

/** Lead volume by source/campaign (descending), with conversion-rate badge.
 * Titled by volume (not "ROI") — the report carries no cost data. */
function SourceRoiBars({ rows }: { rows: SourceRoiRow[] }): ReactElement {
  const sorted = [...rows].sort((a, b) => b.total_leads - a.total_leads);
  const max = Math.max(1, ...sorted.map((r) => r.total_leads));
  return (
    <section aria-label="Lead volume by source" className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Lead volume by source</h2>
      <ol className="space-y-2">
        {sorted.map((r) => (
          <Bar
            key={`${r.source}|${r.campaign_code ?? ''}|${r.partner_id ?? ''}`}
            label={r.campaign_code ? `${r.source} · ${r.campaign_code}` : r.source}
            value={r.total_leads}
            pctOfMax={(r.total_leads / max) * 100}
            badge={r.conversion_rate_pct === '–' ? '–' : `${r.conversion_rate_pct}%`}
          />
        ))}
      </ol>
    </section>
  );
}
