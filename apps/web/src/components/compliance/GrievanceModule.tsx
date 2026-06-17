/**
 * FR-114 — Top-level Compliance Console: grievance queue, filter bar, and drawer.
 * Server state via React Query (useGrievances, useUpdateGrievance).
 * EscalationBanner rendered inline per row when slaDueAt < now and status ∉ {resolved, closed}.
 * Row click → opens GrievanceDrawer with detail + resolution form.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { isApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusChip } from '@/components/workspace/StatusChip';
import { GrievanceFilterBar } from './GrievanceFilterBar';
import { GrievanceDrawer } from './GrievanceDrawer';
import {
  useGrievances,
  useCreateGrievance,
  useUpdateGrievance,
  type ListGrievancesParams,
} from './useGrievances';
import type { GrievanceItem, UpdateGrievanceInput } from './grievance.types';

// ── EscalationBanner ──────────────────────────────────────────────────────────

function EscalationBanner(): JSX.Element {
  return (
    <span
      aria-label="SLA breached"
      className="ml-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Overdue
    </span>
  );
}

function isBreached(grievance: GrievanceItem): boolean {
  if (!grievance.slaDueAt) return false;
  if (grievance.status === 'resolved' || grievance.status === 'closed') return false;
  return new Date(grievance.slaDueAt) < new Date();
}

// ── Column factory (takes onClick so cells can open the drawer) ───────────────

function buildColumns(
  onRowClick: (row: GrievanceItem) => void,
): DataTableColumn<GrievanceItem>[] {
  return [
    {
      id: 'grievanceNo',
      header: 'Grievance no.',
      sortable: false,
      cell: (row) => (
        <button
          type="button"
          className="cursor-pointer text-left font-mono text-xs underline-offset-2 hover:underline focus:outline-none focus:ring-1 focus:ring-ring"
          onClick={() => onRowClick(row)}
        >
          {row.grievanceNo}
          {isBreached(row) ? <EscalationBanner /> : null}
        </button>
      ),
    },
    {
      id: 'source',
      header: 'Source',
      cell: (row) => row.source.replaceAll('_', ' '),
    },
    {
      id: 'category',
      header: 'Category',
      cell: (row) => row.category.replaceAll('_', ' '),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => <StatusChip status={row.status} label="Grievance status" />,
    },
    {
      id: 'slaDueAt',
      header: 'SLA due',
      sortable: true,
      cell: (row) =>
        row.slaDueAt
          ? new Date(row.slaDueAt).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : '—',
    },
    {
      id: 'createdAt',
      header: 'Created',
      sortable: true,
      cell: (row) =>
        new Date(row.createdAt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
  ];
}

// ── Inline create panel ───────────────────────────────────────────────────────

interface CreatePanelProps {
  onClose: () => void;
}

function CreateGrievancePanel({ onClose }: CreatePanelProps): JSX.Element {
  const { mutateAsync, isPending } = useCreateGrievance();

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">Create grievance</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void mutateAsync({
            source: fd.get('source') as GrievanceItem['source'],
            category: fd.get('category') as GrievanceItem['category'],
            description: fd.get('description') as string,
          })
            .then(() => {
              toast.success('Grievance created.');
              onClose();
            })
            .catch((err: unknown) => {
              const msg = isApiClientError(err) ? err.message : 'Failed to create grievance.';
              toast.error(msg);
            });
        }}
        className="space-y-3"
      >
        <div className="space-y-1">
          <label htmlFor="grv-source" className="text-sm font-medium">
            Source <span className="text-destructive" aria-hidden>*</span>
          </label>
          <select
            id="grv-source"
            name="source"
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select source</option>
            {(
              ['rm', 'branch', 'call_centre', 'partner', 'admin', 'customer_link'] as const
            ).map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="grv-category" className="text-sm font-medium">
            Category <span className="text-destructive" aria-hidden>*</span>
          </label>
          <select
            id="grv-category"
            name="category"
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select category</option>
            {(
              ['service_delay', 'mis_selling', 'data_privacy', 'document_issue', 'staff_conduct', 'other'] as const
            ).map((c) => (
              <option key={c} value={c}>
                {c.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="grv-description" className="text-sm font-medium">
            Description <span className="text-destructive" aria-hidden>*</span>
          </label>
          <textarea
            id="grv-description"
            name="description"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Create'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── GrievanceModule ───────────────────────────────────────────────────────────

interface GrievanceModuleProps {
  /** If true, the owner-UUID filter is shown (DPO / HEAD scope). */
  showOwnerFilter?: boolean;
}

export function GrievanceModule({ showOwnerFilter = false }: GrievanceModuleProps): JSX.Element {
  const [params, setParams] = useState<ListGrievancesParams>({ page: 1, limit: 25 });
  const [selectedGrievance, setSelectedGrievance] = useState<GrievanceItem | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, refetch } = useGrievances(params);
  const { mutateAsync: updateGrievance } = useUpdateGrievance(
    selectedGrievance?.grievanceId ?? '',
  );

  const rows = data?.data ?? [];
  const pagination = data?.meta.pagination ?? { page: 1, limit: 25, total: 0 };

  async function handleUpdate(_id: string, input: UpdateGrievanceInput): Promise<void> {
    await updateGrievance(input);
  }

  const columns = buildColumns((row) => setSelectedGrievance(row));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Grievances"
        description="Customer grievances with SLA-driven escalation."
        actions={
          <Button onClick={() => setCreating((c) => !c)}>
            {creating ? 'Cancel' : 'Create grievance'}
          </Button>
        }
      />

      {creating ? <CreateGrievancePanel onClose={() => setCreating(false)} /> : null}

      {/* Filter bar */}
      <GrievanceFilterBar
        params={params}
        onChange={setParams}
        showOwnerFilter={showOwnerFilter}
      />

      {/* Queue table */}
      <DataTable<GrievanceItem>
        columns={columns}
        rows={rows}
        getRowId={(r) => r.grievanceId}
        pagination={{
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
        }}
        onPageChange={(page) => setParams((p) => ({ ...p, page }))}
        onLimitChange={(limit) => setParams((p) => ({ ...p, limit, page: 1 }))}
        sort={
          params.sort
            ? {
                columnId: params.sort.replace(/^-/, ''),
                dir: params.sort.startsWith('-') ? 'desc' : 'asc',
              }
            : null
        }
        onSortChange={(s) =>
          setParams((p) => ({
            ...p,
            sort: s.dir === 'desc' ? `-${s.columnId}` : s.columnId,
          }))
        }
        isLoading={isPending}
        error={isError ? 'Failed to load grievances.' : null}
        onRetry={() => void refetch()}
        emptyTitle="No grievances found"
        emptyMessage="Adjust filters or create a new grievance."
      />

      {/* Drawer */}
      <GrievanceDrawer
        grievance={selectedGrievance}
        onClose={() => setSelectedGrievance(null)}
        onUpdate={handleUpdate}
      />
    </div>
  );
}
