// @vitest-environment jsdom
/**
 * FR-112 — Data Rights Queue (DPO Compliance Console).
 *
 * Route: /compliance/data-rights
 * Auth:  DPO only (consent_ledger scope A). Rendered inside AppShell.
 *
 * UI tree (LLD §UI Component Tree §Compliance Console):
 *   DataRightsPage
 *     ├── Page header (title + optional RaiseRequestButton)
 *     ├── FilterBar (status, request_type, due_before)
 *     ├── DataTable (rows=DataRightsItem[]) — overdue rows highlighted amber
 *     └── DataRightsDetailDrawer (slide-in on row click)
 */

import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { AlertTriangle } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { StatusChip } from '@/components/workspace/StatusChip';
import { DataRightsDetailDrawer } from './DataRightsDetailDrawer';
import {
  useDataRights,
  type ListDataRightsParams,
} from './use-data-rights';
import {
  RIGHTS_TYPE_LABELS,
  RIGHTS_STATUS_LABELS,
  type DataRightsItem,
  type RightsStatus,
  type RightsType,
} from './data-rights.types';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Format ISO timestamp to IST dd-MM-yyyy HH:mm (LLD §UI — due_at in IST). */
function formatIST(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Returns true when due_at is in the past and the request is not terminal. */
function isOverdue(item: DataRightsItem): boolean {
  if (!item.dueAt) return false;
  if (item.status === 'fulfilled' || item.status === 'rejected_retained') return false;
  return new Date(item.dueAt) < new Date();
}

// ── FilterBar ─────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: ListDataRightsParams;
  onChange: (filters: ListDataRightsParams) => void;
}

const STATUS_OPTIONS: Array<{ value: RightsStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_review', label: 'In Review' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'rejected_retained', label: 'Rejected / Retained' },
];

const TYPE_OPTIONS: Array<{ value: RightsType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'access', label: 'Access' },
  { value: 'correction', label: 'Correction' },
  { value: 'update', label: 'Update' },
  { value: 'erasure', label: 'Erasure' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'grievance', label: 'Grievance' },
];

function FilterBar({ filters, onChange }: FilterBarProps): JSX.Element {
  return (
    <div className="flex gap-3 flex-wrap" role="search" aria-label="Filter data rights">
      <select
        aria-label="Filter by status"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={filters.status ?? ''}
        onChange={(e) =>
          onChange({ ...filters, status: e.target.value || undefined, page: 1 })
        }
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by request type"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={filters.request_type ?? ''}
        onChange={(e) =>
          onChange({ ...filters, request_type: e.target.value || undefined, page: 1 })
        }
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <input
        type="date"
        aria-label="Filter by due before date"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={filters.due_before ? filters.due_before.slice(0, 10) : ''}
        onChange={(e) =>
          onChange({
            ...filters,
            due_before: e.target.value ? e.target.value + 'T23:59:59Z' : undefined,
            page: 1,
          })
        }
      />
    </div>
  );
}

// ── Column definitions ────────────────────────────────────────────────────────

function buildColumns(onRowClick: (row: DataRightsItem) => void): DataTableColumn<DataRightsItem>[] {
  return [
    {
      id: 'requestType',
      header: 'Type',
      cell: (row) => (
        <button
          type="button"
          className="cursor-pointer text-left text-sm font-medium underline-offset-2 hover:underline focus:outline-none focus:ring-1 focus:ring-ring"
          onClick={() => onRowClick(row)}
        >
          {RIGHTS_TYPE_LABELS[row.requestType]}
          {isOverdue(row) ? (
            <span
              aria-label="Overdue"
              className="ml-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Overdue
            </span>
          ) : null}
        </button>
      ),
    },
    {
      id: 'customerProfileId',
      header: 'Customer',
      cell: (row) => (
        <span className="font-mono text-xs text-slate-600" title={row.customerProfileId}>
          {row.customerProfileId.slice(0, 8)}…
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <StatusChip status={row.status} label={RIGHTS_STATUS_LABELS[row.status]} />
      ),
    },
    {
      id: 'dueAt',
      header: 'Due By (IST)',
      cell: (row) =>
        row.dueAt ? (
          <span className={isOverdue(row) ? 'font-semibold text-amber-600' : 'text-slate-700'}>
            {formatIST(row.dueAt)}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (row) =>
        row.ownerId ? (
          <span className="font-mono text-xs">{row.ownerId.slice(0, 8)}</span>
        ) : (
          <span className="text-slate-400 text-xs">Unassigned</span>
        ),
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (row) => <span className="text-sm">{formatIST(row.createdAt)}</span>,
    },
  ];
}

// ── DataRightsPage ─────────────────────────────────────────────────────────────

/**
 * Main DPO queue page for data-rights requests (FR-112 LLD §UI Component Tree
 * §Compliance Console — Data Rights Queue).
 */
export function DataRightsPage(): JSX.Element {
  const [params, setParams] = useState<ListDataRightsParams>({ page: 1, limit: 25 });
  const [selected, setSelected] = useState<DataRightsItem | null>(null);

  const { data, isPending, isError, refetch } = useDataRights(params);

  const rows: DataRightsItem[] = data?.data ?? [];
  const pagination = data?.meta?.pagination ?? { page: 1, limit: 25, total: 0 };

  const columns = buildColumns((row) => setSelected(row));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data Rights Requests"
        description="Data-principal access & erasure requests (DPDPA), with legal-hold awareness."
      />

      {/* Filter bar */}
      <FilterBar
        filters={params}
        onChange={(f) => setParams({ ...f, page: 1 })}
      />

      {/* Queue table */}
      <DataTable<DataRightsItem>
        columns={columns}
        rows={rows}
        getRowId={(r) => r.dataRightsRequestId}
        pagination={{
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
        }}
        onPageChange={(page) => setParams((p) => ({ ...p, page }))}
        onLimitChange={(limit) => setParams((p) => ({ ...p, limit, page: 1 }))}
        isLoading={isPending}
        error={isError ? 'Failed to load data rights requests.' : null}
        onRetry={() => void refetch()}
        emptyTitle="No data rights requests found"
        emptyMessage="Adjust filters or wait for new requests."
      />

      {/* Detail drawer */}
      <DataRightsDetailDrawer
        request={selected}
        onClose={() => setSelected(null)}
        onUpdated={() => {
          setSelected(null);
          void refetch();
        }}
      />
    </div>
  );
}
