/**
 * FR-113 — DLA/LSP Registry (Compliance Console).
 *
 * Route: /compliance/dla
 * Auth:  DPO / ADMIN only (configuration capability, managed by AbacGuard on the API).
 *        "Add Entry" button is hidden from non-DPO/ADMIN roles.
 *
 * UI tree (LLD §UI Component Tree §A):
 *   DlaRegistryPage
 *     ├── PageHeader (title + "Add Entry" button [DPO/ADMIN only])
 *     ├── Filter bar (type, status selects)
 *     ├── DataTable (columns: name | type | owner | status | updated_at | actions)
 *     │     ├── StatusChip (draft→grey, active→green, retired→muted)
 *     │     └── Action: "Edit" → DlaRegistryDrawer (update mode)
 *     ├── EmptyState (no results)
 *     ├── LoadingSkeleton (loading)
 *     └── DlaRegistryDrawer (create / update)
 */

import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { DlaRegistryDrawer } from '@/components/compliance/DlaRegistryDrawer';
import {
  useDlaRegistry,
  useCreateDla,
  useUpdateDla,
  type ListDlaParams,
} from '@/components/compliance/use-dla-registry';
import {
  DLA_TYPE_LABELS,
  CONFIG_STATUS_LABELS,
  type DlaItem,
  type DlaType,
  type ConfigStatus,
  type CreateDlaInput,
  type UpdateDlaInput,
} from '@/components/compliance/dla-registry.types';

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
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

// ── FilterBar ─────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: ListDlaParams;
  onChange: (filters: ListDlaParams) => void;
}

function FilterBar({ filters, onChange }: FilterBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Type filter */}
      <select
        aria-label="Filter by type"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={filters.type ?? ''}
        onChange={(e) =>
          onChange({ ...filters, type: (e.target.value as DlaType) || undefined, page: 1 })
        }
      >
        <option value="">All types</option>
        {(Object.entries(DLA_TYPE_LABELS) as [DlaType, string][]).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>

      {/* Status filter */}
      <select
        aria-label="Filter by status"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={filters.status ?? ''}
        onChange={(e) =>
          onChange({ ...filters, status: (e.target.value as ConfigStatus) || undefined, page: 1 })
        }
      >
        <option value="">All statuses</option>
        {(Object.entries(CONFIG_STATUS_LABELS) as [ConfigStatus, string][]).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>
    </div>
  );
}

// ── DlaRegistryPage ───────────────────────────────────────────────────────────

interface DlaRegistryPageProps {
  /** Role of the current authenticated user — controls "Add Entry" visibility. */
  callerRole?: string;
}

const ALLOWED_ROLES = new Set(['DPO', 'ADMIN']);

export function DlaRegistryPage({ callerRole }: DlaRegistryPageProps): JSX.Element {
  const [filters, setFilters] = useState<ListDlaParams>({ page: 1, limit: 25 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<DlaItem | null>(null);

  const { data, isLoading, error, refetch } = useDlaRegistry(filters);
  const createMutation = useCreateDla();
  const updateMutation = useUpdateDla();

  const rows = data?.data ?? [];
  const pagination = data?.meta?.pagination ?? { page: 1, limit: 25, total: 0 };
  const canManage = callerRole ? ALLOWED_ROLES.has(callerRole) : false;

  const columns: DataTableColumn<DlaItem>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => <span className="font-medium text-gray-900">{row.name}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      cell: (row) => <span className="text-sm text-gray-600">{DLA_TYPE_LABELS[row.type]}</span>,
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (row) => <span className="text-sm text-gray-600">{row.owner ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      id: 'updated_at',
      header: 'Updated',
      cell: (row) => <span className="text-sm text-gray-500">{formatDate(row.updatedAt)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: (row) =>
        canManage ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditEntry(row);
              setDrawerOpen(false);
            }}
          >
            Edit
          </Button>
        ) : null,
    },
  ];

  async function handleSave(input: CreateDlaInput | UpdateDlaInput): Promise<void> {
    if ('dla_registry_id' in input) {
      await updateMutation.mutateAsync(input as UpdateDlaInput);
    } else {
      await createMutation.mutateAsync(input as CreateDlaInput);
    }
  }

  function openAddDrawer(): void {
    setEditEntry(null);
    setDrawerOpen(true);
  }

  function closeDrawer(): void {
    setEditEntry(null);
    setDrawerOpen(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="DLA / LSP Registry"
        description="Digital lending agents & lending service providers — disclosure governance."
        actions={
          canManage ? (
            <Button onClick={openAddDrawer} className="gap-2">
              <PlusCircle className="h-4 w-4" />
              Add Entry
            </Button>
          ) : undefined
        }
      />

      {/* Filter bar */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* Table */}
      <DataTable<DlaItem>
        columns={columns}
        rows={rows}
        getRowId={(row) => row.dlaRegistryId}
        pagination={{
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
        }}
        onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
        isLoading={isLoading}
        error={error ? String(error) : null}
        onRetry={() => void refetch()}
        emptyTitle="No DLA/LSP entries"
        emptyMessage="Add an entry to build the RBI disclosure registry."
      />

      {/* Drawer (create or edit) */}
      <DlaRegistryDrawer
        entry={editEntry}
        open={drawerOpen}
        onClose={closeDrawer}
        onSave={handleSave}
        callerRole={callerRole}
      />
    </div>
  );
}
