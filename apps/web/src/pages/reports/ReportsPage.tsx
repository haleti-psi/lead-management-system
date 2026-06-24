import type { ReactElement } from 'react';
import { useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useReport } from '@/hooks/use-report';
import type { ReportCode, ReportParams } from '@/lib/api/reports';
import { ReportFilterBar } from './ReportFilterBar';
import { ReportViewer } from './ReportViewer';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';

const REPORT_OPTIONS: { code: ReportCode; label: string }[] = [
  // FR-120 core pack
  { code: 'funnel_conversion', label: 'Funnel / Conversion' },
  { code: 'source_performance', label: 'Source Performance' },
  { code: 'rm_performance', label: 'RM / Team Performance' },
  { code: 'rejection_summary', label: 'Rejection Summary' },
  // FR-121 differentiator pack
  { code: 'first_contact_sla', label: 'First Contact SLA' },
  { code: 'kyc_doc_ageing', label: 'KYC & Document Ageing' },
  { code: 'dsa_dealer_quality', label: 'DSA / Dealer Quality' },
  { code: 'duplicate_leakage', label: 'Duplicate Leakage' },
  { code: 'handoff_failure', label: 'Handoff Failure' },
  { code: 'source_roi', label: 'Source ROI' },
  { code: 'contactability', label: 'Contactability' },
  { code: 'consent_privacy_ops', label: 'Consent & Privacy Ops' },
  { code: 'product_branch_heatmap', label: 'Product / Branch Heatmap' },
  { code: 'rm_capacity_load', label: 'RM Capacity & Load' },
];

/**
 * FR-120 — Reports page at `/reports`. Hosts report selector (tabs),
 * filter bar, and the report viewer table. All filter controls are
 * scope-aware (hidden for RM per U-01/U-02 tests).
 */
export function ReportsPage(): ReactElement {
  const { user } = useAuth();
  const [activeCode, setActiveCode] = useState<ReportCode>('funnel_conversion');
  const [params, setParams] = useState<ReportParams>({});

  const { data, isLoading, isError, errorCode, refetch } = useReport(activeCode, params);

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="Aggregate reports scoped to your access level." />

      {/* Report selector — a wrapping pill group (single-select; mobile-friendly) */}
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Report
        </p>
        <div role="tablist" aria-label="Report type" className="flex flex-wrap gap-2">
          {REPORT_OPTIONS.map(({ code, label }) => {
            const selected = code === activeCode;
            return (
              <button
                key={code}
                role="tab"
                aria-selected={selected}
                aria-controls={`report-panel-${code}`}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  selected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                onClick={() => {
                  setActiveCode(code);
                  setParams({});
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter bar */}
      <ReportFilterBar
        code={activeCode}
        userRole={user?.role ?? ''}
        onApply={(newParams) => setParams(newParams)}
      />

      {/* Report viewer */}
      <div
        id={`report-panel-${activeCode}`}
        role="tabpanel"
        aria-label={`${activeCode} report data`}
      >
        <ReportViewer
          code={activeCode}
          data={data}
          isLoading={isLoading}
          isError={isError}
          errorCode={errorCode}
        />
      </div>

      {/* Retry button on error */}
      {isError && (
        <button
          type="button"
          className="text-sm text-primary underline"
          onClick={() => refetch()}
        >
          Retry
        </button>
      )}
    </div>
  );
}
