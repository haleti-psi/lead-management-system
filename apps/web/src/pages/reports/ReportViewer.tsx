import type { ReactElement } from 'react';

import type { ReportCode, ReportData } from '@/lib/api/reports';
import { ReportChart } from '@/components/reporting/ReportChart';

interface ReportViewerProps {
  code: ReportCode;
  data: ReportData | undefined;
  isLoading: boolean;
  isError: boolean;
  errorCode: string | null;
}

/**
 * FR-120 — report viewer component. Renders the correct DataTable for the
 * active report code, with mandatory loading/empty/error states (LLD §UI
 * Component Tree; tests U-03, U-04, U-05, U-06). Percentage cells render
 * literal `–` when the value is `"–"` (zero-denominator rule §12.5).
 */
export function ReportViewer({
  code,
  data,
  isLoading,
  isError,
  errorCode,
}: ReportViewerProps): ReactElement {
  // U-04: LoadingSkeleton while in-flight
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading report" className="space-y-2">
        {[...Array<number>(5)].map((_, i) => (
          <div key={i} className="h-8 rounded bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  // U-06: ErrorState on FORBIDDEN / VALIDATION_ERROR / INTERNAL_ERROR
  if (isError) {
    const message =
      errorCode === 'FORBIDDEN'
        ? 'You do not have permission to view this report.'
        : errorCode === 'VALIDATION_ERROR'
          ? 'Invalid report parameters. Please check your filters.'
          : 'An error occurred while loading this report. Please try again.';

    return (
      <div role="alert" aria-label="Report error" className="rounded-lg border border-destructive p-6 text-destructive">
        <p className="font-medium">{message}</p>
        {errorCode && (
          <p className="mt-1 text-sm opacity-75">Error code: {errorCode}</p>
        )}
      </div>
    );
  }

  // U-05: EmptyState when rows = []
  if (!data || data.rows.length === 0) {
    return (
      <div role="status" aria-label="No report data" className="rounded-lg border p-8 text-center text-muted-foreground">
        <p>No data for the selected filters and period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ReportChart code={code} rows={data.rows} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={`${code} report`}>
        <thead>
          <tr className="border-b">
            {getColumns(code).map((col) => (
              <th key={col.key} scope="col" className="px-3 py-2 text-left font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, idx) => (
            <tr key={idx} className="border-b last:border-0">
              {getColumns(code).map((col) => {
                const value = (row as unknown as Record<string, unknown>)[col.key];
                const display =
                  typeof value === 'string' && value === '–'
                    ? '–' // U-03: zero-denominator renders literal –
                    : String(value ?? '');
                return (
                  <td key={col.key} className="px-3 py-2">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

interface Column {
  key: string;
  label: string;
}

function getColumns(code: ReportCode): Column[] {
  switch (code) {
    // ── FR-120 core pack ─────────────────────────────────────────────────────
    case 'funnel_conversion':
      return [
        { key: 'dimension', label: 'Product' },
        { key: 'captured', label: 'Captured' },
        { key: 'assigned', label: 'Assigned' },
        { key: 'contacted', label: 'Contacted' },
        { key: 'qualified', label: 'Qualified' },
        { key: 'documents_pending', label: 'Docs Pending' },
        { key: 'kyc_in_progress', label: 'KYC In Progress' },
        { key: 'handed_off', label: 'Handed Off' },
        { key: 'rejected', label: 'Rejected' },
        { key: 'active_pipeline', label: 'Active Pipeline' },
        { key: 'overall_conversion_pct', label: 'Conversion %' },
        { key: 'kyc_conversion_pct', label: 'KYC→HO %' },
      ];
    case 'source_performance':
      return [
        { key: 'source', label: 'Source' },
        { key: 'captured', label: 'Captured' },
        { key: 'handed_off', label: 'Handed Off' },
        { key: 'source_conversion_pct', label: 'Conversion %' },
      ];
    case 'rm_performance':
      return [
        { key: 'owner_name', label: 'RM Name' },
        { key: 'captured', label: 'Captured' },
        { key: 'contacted', label: 'Contacted' },
        { key: 'qualified', label: 'Qualified' },
        { key: 'handed_off', label: 'Handed Off' },
        { key: 'rejected', label: 'Rejected' },
        { key: 'rejection_rate_pct', label: 'Rejection Rate %' },
      ];
    case 'rejection_summary':
      return [
        { key: 'primary_reason', label: 'Primary Reason' },
        { key: 'sub_reason', label: 'Sub Reason' },
        { key: 'rejected_count', label: 'Count' },
      ];

    // ── FR-121 differentiator pack ────────────────────────────────────────────
    case 'first_contact_sla':
      return [
        { key: 'branch_name', label: 'Branch' },
        { key: 'total', label: 'Total Leads' },
        { key: 'contacted', label: 'Contacted' },
        { key: 'breached', label: 'SLA Breached' },
        { key: 'compliance_pct', label: 'Compliance %' },
      ];
    case 'kyc_doc_ageing':
      return [
        { key: 'doc_type', label: 'Document Type' },
        { key: 'product_code', label: 'Product' },
        { key: 'avg_age_days', label: 'Avg Age (days)' },
        { key: 'doc_count', label: 'Total Docs' },
        { key: 'verified_count', label: 'Verified' },
        { key: 'pending_count', label: 'Pending' },
      ];
    case 'dsa_dealer_quality':
      return [
        { key: 'legal_name', label: 'Partner Name' },
        { key: 'type', label: 'Type' },
        { key: 'quality_score', label: 'Quality Score' },
        { key: 'insufficient_data', label: 'Insufficient Data' },
      ];
    case 'duplicate_leakage':
      return [
        { key: 'source', label: 'Source' },
        { key: 'confidence', label: 'Confidence' },
        { key: 'action', label: 'Action' },
        { key: 'status', label: 'Status' },
        { key: 'count', label: 'Count' },
      ];
    case 'handoff_failure':
      return [
        { key: 'integration', label: 'Integration' },
        { key: 'error_code', label: 'Error Code' },
        { key: 'http_status', label: 'HTTP Status' },
        { key: 'failure_count', label: 'Failures' },
        { key: 'avg_retries', label: 'Avg Retries' },
        { key: 'last_seen_at', label: 'Last Seen' },
      ];
    case 'source_roi':
      return [
        { key: 'source', label: 'Source' },
        { key: 'campaign_code', label: 'Campaign' },
        { key: 'total_leads', label: 'Total Leads' },
        { key: 'converted', label: 'Converted' },
        { key: 'rejected', label: 'Rejected' },
        { key: 'conversion_rate_pct', label: 'Conversion %' },
      ];
    case 'contactability':
      return [
        { key: 'source', label: 'Source' },
        { key: 'channel', label: 'Channel' },
        { key: 'total_attempts', label: 'Attempts' },
        { key: 'delivered', label: 'Delivered' },
        { key: 'failed', label: 'Failed' },
        { key: 'contactability_rate_pct', label: 'Contactability %' },
      ];
    case 'consent_privacy_ops':
      return [
        { key: 'type', label: 'Category' },
      ];
    case 'product_branch_heatmap':
      return [
        { key: 'product_code', label: 'Product' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'volume', label: 'Volume' },
        { key: 'converted', label: 'Converted' },
        { key: 'rejected', label: 'Rejected' },
        { key: 'conversion_rate_pct', label: 'Conversion %' },
        { key: 'avg_tat_hrs', label: 'Avg TAT (hrs)' },
      ];
    case 'rm_capacity_load':
      return [
        { key: 'full_name', label: 'RM Name' },
        { key: 'active_leads', label: 'Active Leads' },
        { key: 'early_stage_leads', label: 'Early Stage' },
        { key: 'open_tasks', label: 'Open Tasks' },
        { key: 'overdue_tasks', label: 'Overdue Tasks' },
      ];
  }
}
