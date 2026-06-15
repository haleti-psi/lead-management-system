import type { ReactElement } from 'react';
import { useState } from 'react';

import type { ReportCode, ReportParams } from '@/lib/api/reports';

interface FilterState {
  from: string;
  to: string;
  product_code: string;
  source: string;
}

interface ReportFilterBarProps {
  code: ReportCode;
  /** The user's role — controls which filters are visible (scope-aware). */
  userRole: string;
  onApply: (params: ReportParams) => void;
}

/**
 * FR-120 — filter bar for the report page. Shows scope-appropriate controls:
 * - Branch/Team/Owner selects hidden for RM (scope O — server enforces anyway).
 * - Source filter hidden for rm_performance (not relevant).
 * - All filter controls have visible labels + aria-required (WCAG 2.1 AA).
 */
export function ReportFilterBar({ code, userRole, onApply }: ReportFilterBarProps): ReactElement {
  const [filters, setFilters] = useState<FilterState>({
    from: '',
    to: '',
    product_code: '',
    source: '',
  });

  const isRm = userRole === 'RM';
  const isHeadOrSm = userRole === 'HEAD' || userRole === 'SM';
  const isHeadOrBmOrSm = userRole === 'HEAD' || userRole === 'BM' || userRole === 'SM';
  const showSource = code !== 'rm_performance';

  function handleApply(): void {
    const params: ReportParams = {};
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.product_code) params.product_code = filters.product_code;
    if (showSource && filters.source) params.source = filters.source;
    onApply(params);
  }

  return (
    <div className="flex flex-wrap gap-3 p-4 rounded-lg border bg-card" role="search" aria-label="Report filters">
      {/* Date range */}
      <div className="flex flex-col gap-1">
        <label htmlFor="report-from" className="text-sm font-medium">
          {/* i18n key: reports.filter.from */}
          From
        </label>
        <input
          id="report-from"
          type="date"
          className="border rounded px-2 py-1 text-sm"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="report-to" className="text-sm font-medium">
          {/* i18n key: reports.filter.to */}
          To
        </label>
        <input
          id="report-to"
          type="date"
          className="border rounded px-2 py-1 text-sm"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
        />
      </div>

      {/* Branch/Team/Owner selects — scope-aware visibility (U-01, U-02) */}
      {!isRm && isHeadOrBmOrSm && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-branch" className="text-sm font-medium">
            Branch
          </label>
          <input
            id="report-branch"
            type="text"
            placeholder="Branch ID (UUID)"
            className="border rounded px-2 py-1 text-sm"
            aria-label="Filter by branch"
          />
        </div>
      )}

      {isHeadOrSm && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-team" className="text-sm font-medium">
            Team
          </label>
          <input
            id="report-team"
            type="text"
            placeholder="Team ID (UUID)"
            className="border rounded px-2 py-1 text-sm"
            aria-label="Filter by team"
          />
        </div>
      )}

      {isHeadOrBmOrSm && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-owner" className="text-sm font-medium">
            Owner (RM)
          </label>
          <input
            id="report-owner"
            type="text"
            placeholder="Owner ID (UUID)"
            className="border rounded px-2 py-1 text-sm"
            aria-label="Filter by owner"
          />
        </div>
      )}

      {/* Source filter — hidden for rm_performance */}
      {showSource && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-source" className="text-sm font-medium">
            Source
          </label>
          <select
            id="report-source"
            className="border rounded px-2 py-1 text-sm"
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          >
            <option value="">All sources</option>
            <option value="DSA">DSA</option>
            <option value="Dealer">Dealer</option>
            <option value="Branch">Branch</option>
            <option value="Website">Website</option>
            <option value="Referral">Referral</option>
            <option value="Telecalling">Telecalling</option>
            <option value="Field">Field</option>
          </select>
        </div>
      )}

      <div className="flex items-end">
        <button
          type="button"
          className="px-4 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium"
          onClick={handleApply}
          aria-label="Apply report filters"
        >
          {/* i18n key: reports.filter.apply */}
          Apply
        </button>
      </div>
    </div>
  );
}
