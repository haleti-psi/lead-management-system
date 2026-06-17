import type { ReactElement } from 'react';

import type { TaskFilters, TaskStatus, TaskType } from './use-tasks';

/** All filter labels. */
const STATUS_OPTIONS: Array<{ label: string; value: TaskStatus }> = [
  { label: 'Open', value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Cancelled', value: 'cancelled' },
];

const TYPE_OPTIONS: Array<{ label: string; value: TaskType }> = [
  { label: 'Call', value: 'call' },
  { label: 'Visit', value: 'visit' },
  { label: 'Doc Request', value: 'doc_request' },
  { label: 'KYC Appointment', value: 'kyc_appt' },
  { label: 'Dealer Follow-up', value: 'dealer_followup' },
  { label: 'Callback', value: 'callback' },
  { label: 'Approval', value: 'approval' },
  { label: 'Handoff Retry', value: 'handoff_retry' },
  { label: 'Nurture', value: 'nurture' },
];

interface TaskFiltersProps {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
}

/**
 * FR-100 — Filter bar for the task list.
 * Uses native HTML selects (shadcn Select not available in this wave's web foundation).
 * Renders status, type, and due_before date filters.
 */
export function TaskFiltersBar({ filters, onChange }: TaskFiltersProps): ReactElement {
  function handleStatus(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value as TaskStatus | '';
    onChange({ ...filters, status: value !== '' ? value : undefined, page: 1 });
  }

  function handleType(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value as TaskType | '';
    onChange({ ...filters, type: value !== '' ? value : undefined, page: 1 });
  }

  function handleDueBefore(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    onChange({ ...filters, due_before: value !== '' ? new Date(value).toISOString() : undefined, page: 1 });
  }

  return (
    <div className="flex flex-wrap gap-3 py-2" role="search" aria-label="Task filters">
      {/* Status filter */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="task-filter-status">
          Status
        </label>
        <select
          id="task-filter-status"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={filters.status ?? ''}
          onChange={handleStatus}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Type filter */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="task-filter-type">
          Type
        </label>
        <select
          id="task-filter-type"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={filters.type ?? ''}
          onChange={handleType}
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Due before date filter */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="task-filter-due-before">
          Due before
        </label>
        <input
          id="task-filter-due-before"
          type="datetime-local"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={handleDueBefore}
        />
      </div>
    </div>
  );
}
