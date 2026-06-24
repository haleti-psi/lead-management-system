import type { ReactElement } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ReportCode, ReportParams } from '@/lib/api/reports';

interface FilterState {
  from: string;
  to: string;
  branch_id: string;
  team_id: string;
  owner_id: string;
  product_code: string;
  source: string;
}

interface ReportFilterBarProps {
  code: ReportCode;
  /** The user's role — controls which filters are visible (scope-aware). */
  userRole: string;
  onApply: (params: ReportParams) => void;
}

const FIELD_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * FR-120 — filter bar for the report page. Shows scope-appropriate controls:
 * - Branch/Team/Owner inputs hidden for RM (scope O — server enforces anyway).
 * - Source filter hidden for rm_performance (not relevant).
 * - Dates cannot be in the future and the range is self-consistent (to ≥ from).
 * - All filter controls have visible labels + aria-labels (WCAG 2.1 AA).
 */
export function ReportFilterBar({ code, userRole, onApply }: ReportFilterBarProps): ReactElement {
  const [filters, setFilters] = useState<FilterState>({
    from: '',
    to: '',
    branch_id: '',
    team_id: '',
    owner_id: '',
    product_code: '',
    source: '',
  });

  const isRm = userRole === 'RM';
  const isHeadOrSm = userRole === 'HEAD' || userRole === 'SM';
  const isHeadOrBmOrSm = userRole === 'HEAD' || userRole === 'BM' || userRole === 'SM';
  const showSource = code !== 'rm_performance';
  const today = new Date().toISOString().slice(0, 10);

  function set<K extends keyof FilterState>(key: K, value: string): void {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function handleApply(): void {
    const params: ReportParams = {};
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (!isRm && isHeadOrBmOrSm && filters.branch_id.trim()) params.branch_id = filters.branch_id.trim();
    if (isHeadOrSm && filters.team_id.trim()) params.team_id = filters.team_id.trim();
    if (isHeadOrBmOrSm && filters.owner_id.trim()) params.owner_id = filters.owner_id.trim();
    if (filters.product_code) params.product_code = filters.product_code;
    if (showSource && filters.source) params.source = filters.source;
    onApply(params);
  }

  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      role="search"
      aria-label="Report filters"
    >
      {/* Date range — future dates disabled; range kept consistent. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="report-from" className="text-xs font-medium text-muted-foreground">
          From
        </label>
        <input
          id="report-from"
          type="date"
          className={FIELD_CLASS}
          max={filters.to || today}
          value={filters.from}
          onChange={(e) => set('from', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="report-to" className="text-xs font-medium text-muted-foreground">
          To
        </label>
        <input
          id="report-to"
          type="date"
          className={FIELD_CLASS}
          min={filters.from || undefined}
          max={today}
          value={filters.to}
          onChange={(e) => set('to', e.target.value)}
        />
      </div>

      {/* Branch/Team/Owner — scope-aware visibility (U-01, U-02). */}
      {!isRm && isHeadOrBmOrSm && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-branch" className="text-xs font-medium text-muted-foreground">
            Branch
          </label>
          <input
            id="report-branch"
            type="text"
            placeholder="Branch ID"
            className={FIELD_CLASS}
            aria-label="Filter by branch"
            value={filters.branch_id}
            onChange={(e) => set('branch_id', e.target.value)}
          />
        </div>
      )}

      {isHeadOrSm && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-team" className="text-xs font-medium text-muted-foreground">
            Team
          </label>
          <input
            id="report-team"
            type="text"
            placeholder="Team ID"
            className={FIELD_CLASS}
            aria-label="Filter by team"
            value={filters.team_id}
            onChange={(e) => set('team_id', e.target.value)}
          />
        </div>
      )}

      {isHeadOrBmOrSm && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-owner" className="text-xs font-medium text-muted-foreground">
            Owner (RM)
          </label>
          <input
            id="report-owner"
            type="text"
            placeholder="Owner ID"
            className={FIELD_CLASS}
            aria-label="Filter by owner"
            value={filters.owner_id}
            onChange={(e) => set('owner_id', e.target.value)}
          />
        </div>
      )}

      {/* Source filter — hidden for rm_performance. */}
      {showSource && (
        <div className="flex flex-col gap-1">
          <label htmlFor="report-source" className="text-xs font-medium text-muted-foreground">
            Source
          </label>
          <select
            id="report-source"
            className={FIELD_CLASS}
            value={filters.source}
            onChange={(e) => set('source', e.target.value)}
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

      <Button onClick={handleApply} aria-label="Apply report filters">
        Apply
      </Button>
    </div>
  );
}
