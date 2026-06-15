import type { ReactElement } from 'react';
import { useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useReport } from '@/hooks/use-report';
import type { ReportCode, ReportParams } from '@/lib/api/reports';
import { ReportFilterBar } from './ReportFilterBar';
import { ReportViewer } from './ReportViewer';

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
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold">
          {/* i18n key: reports.title */}
          Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregate reports scoped to your access level.
        </p>
      </div>

      {/* Report selector — tabs */}
      <div role="tablist" aria-label="Report type" className="flex gap-1 border-b">
        {REPORT_OPTIONS.map(({ code, label }) => (
          <button
            key={code}
            role="tab"
            aria-selected={code === activeCode}
            aria-controls={`report-panel-${code}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              code === activeCode
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setActiveCode(code);
              setParams({});
            }}
          >
            {label}
          </button>
        ))}
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
