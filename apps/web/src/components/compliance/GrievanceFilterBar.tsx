/**
 * FR-114 — Filter bar for the grievance list.
 * Controls: status chip-buttons, category select, date range (from/to), owner UUID.
 * Each change fires `onChange` with the updated params — no local submit button;
 * the host debounces or reacts immediately (React Query will refetch on param change).
 */

import type { ListGrievancesParams } from './useGrievances';
import type { GrievanceCategory, GrievanceStatus } from './grievance.types';
import { StatusChip } from '@/components/ui/StatusChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STATUSES: GrievanceStatus[] = ['open', 'in_progress', 'escalated', 'resolved', 'closed'];
const CATEGORIES: GrievanceCategory[] = [
  'service_delay',
  'mis_selling',
  'data_privacy',
  'document_issue',
  'staff_conduct',
  'other',
];

interface GrievanceFilterBarProps {
  params: ListGrievancesParams;
  onChange: (updated: ListGrievancesParams) => void;
  /** If true, shows the owner UUID filter (DPO / HEAD only). */
  showOwnerFilter?: boolean;
}

export function GrievanceFilterBar({
  params,
  onChange,
  showOwnerFilter = false,
}: GrievanceFilterBarProps): JSX.Element {
  function set(patch: Partial<ListGrievancesParams>): void {
    onChange({ ...params, page: 1, ...patch });
  }

  function toggleStatus(s: GrievanceStatus): void {
    set({ status: params.status === s ? undefined : s });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Grievance filters"
    >
      {/* Status chip buttons */}
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={params.status === s}
          onClick={() => toggleStatus(s)}
          className="cursor-pointer rounded-full border border-transparent hover:border-border focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <StatusChip
            status={s}
            label={`Filter by ${s}`}
            className={params.status === s ? 'ring-2 ring-ring' : ''}
          />
        </button>
      ))}

      {/* Category select */}
      <label className="sr-only" htmlFor="category-filter">
        Category
      </label>
      <select
        id="category-filter"
        aria-label="Filter by category"
        value={params.category ?? ''}
        onChange={(e) => set({ category: e.target.value || undefined })}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c.replaceAll('_', ' ')}
          </option>
        ))}
      </select>

      {/* Date range */}
      <label className="sr-only" htmlFor="from-filter">
        From date
      </label>
      <Input
        id="from-filter"
        type="date"
        aria-label="From date"
        className="h-8 w-36"
        value={params.from ?? ''}
        onChange={(e) => set({ from: e.target.value || undefined })}
      />
      <label className="sr-only" htmlFor="to-filter">
        To date
      </label>
      <Input
        id="to-filter"
        type="date"
        aria-label="To date"
        className="h-8 w-36"
        value={params.to ?? ''}
        onChange={(e) => set({ to: e.target.value || undefined })}
      />

      {/* Owner UUID filter — DPO / HEAD only */}
      {showOwnerFilter ? (
        <>
          <label className="sr-only" htmlFor="owner-filter">
            Owner UUID
          </label>
          <Input
            id="owner-filter"
            aria-label="Filter by owner UUID"
            placeholder="Owner UUID"
            className="h-8 w-60"
            value={params.owner_id ?? ''}
            onChange={(e) => set({ owner_id: e.target.value || undefined })}
          />
        </>
      ) : null}

      {/* Clear all filters */}
      {(params.status || params.category || params.from || params.to || params.owner_id) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              page: 1,
              limit: params.limit,
            })
          }
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
