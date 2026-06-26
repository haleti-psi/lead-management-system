import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCan } from '@/lib/auth/capabilities';
import { useMasterList } from '@/hooks/use-master-data';
import {
  MASTER_RESOURCE_LIST,
  MASTER_RESOURCES,
  type BranchView,
  type BusinessCalendarView,
  type MasterRecordView,
  type MasterResourceMeta,
  type MasterSlug,
  type RegionView,
  type RejectionReasonView,
} from '@/types/master-data';
import { cn } from '@/lib/utils';
import { RegionForm } from './forms/RegionForm';
import { BranchForm } from './forms/BranchForm';
import { RejectionReasonForm } from './forms/RejectionReasonForm';
import { BusinessCalendarForm } from './forms/BusinessCalendarForm';
import { DeactivateMasterDialog } from './DeactivateMasterDialog';

/** "no_response" → "No response" for enum display. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type ModalState =
  | { kind: 'create' }
  | { kind: 'edit'; record: MasterRecordView }
  | { kind: 'deactivate'; record: MasterRecordView }
  | null;

/**
 * FR-131 §UI — Master Data administration (mounts at `/admin/master`, capability
 * `configuration`). A resource selector over the allow-listed master resources
 * (regions, branches, rejection-reasons, business-calendars) drives a
 * server-paginated DataTable; create/edit happen in a Modal whose fields match the
 * selected resource's descriptor, and deactivation (for resources with an
 * `is_active` column) is in-use-guarded with a clear CONFLICT message. Affordances
 * are gated by `useCan('configuration')`; the server remains authoritative.
 */
export function MasterDataPage(): JSX.Element {
  const can = useCan();
  const canManage = can('configuration');

  const [slug, setSlug] = React.useState<MasterSlug>('regions');
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [activeFilter, setActiveFilter] = React.useState<'all' | 'active' | 'inactive'>('all');
  const [modal, setModal] = React.useState<ModalState>(null);

  const meta = MASTER_RESOURCES[slug];
  const hasActiveness = meta.activeness === 'boolean';
  const isActive = !hasActiveness || activeFilter === 'all' ? undefined : activeFilter === 'active';

  const queryResult = useMasterList(slug, { page, limit, isActive }, canManage);
  const result = queryResult.data;

  function switchResource(next: MasterSlug): void {
    setSlug(next);
    setPage(1);
    setActiveFilter('all');
    setModal(null);
  }

  if (!canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Master Data</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don't have access to master configuration.
        </p>
      </div>
    );
  }

  const columns = buildColumns(meta, canManage, {
    onEdit: (record) => setModal({ kind: 'edit', record }),
    onDeactivate: (record) => setModal({ kind: 'deactivate', record }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/admin"
        backLabel="Configuration"
        title="Master Data"
        description="Branches, products, sources and other reference lists."
        actions={
          <Button onClick={() => setModal({ kind: 'create' })}>
            <Plus className="h-4 w-4" aria-hidden />
            Add {meta.singular}
          </Button>
        }
      />

      {/* Resource selector */}
      <nav aria-label="Master resource" className="flex flex-wrap gap-2 border-b pb-2">
        {MASTER_RESOURCE_LIST.map((r) => (
          <button
            key={r.slug}
            type="button"
            onClick={() => switchResource(r.slug)}
            aria-current={r.slug === slug ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              r.slug === slug
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {r.label}
          </button>
        ))}
      </nav>

      {/* Activeness filter (only for resources that can be deactivated) */}
      {hasActiveness ? (
        <label className="flex items-center gap-1 text-sm">
          <span className="sr-only">Filter by status</span>
          <select
            aria-label="Filter by status"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={activeFilter}
            onChange={(e) => {
              setActiveFilter(e.target.value as 'all' | 'active' | 'inactive');
              setPage(1);
            }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      ) : null}

      <DataTable
        columns={columns}
        rows={(result?.data ?? []) as MasterRecordView[]}
        getRowId={(r) => r.id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={queryResult.isLoading}
        error={queryResult.isError ? `Could not load ${meta.label.toLowerCase()}.` : null}
        onRetry={() => void queryResult.refetch()}
        emptyTitle={`No ${meta.label.toLowerCase()} found`}
        emptyMessage={`No ${meta.label.toLowerCase()} have been configured yet.`}
      />

      <Modal
        open={modal?.kind === 'create' || modal?.kind === 'edit'}
        onClose={() => setModal(null)}
        title={
          modal?.kind === 'edit' ? `Edit ${meta.singular}` : `Add ${meta.singular}`
        }
      >
        {modal?.kind === 'create' || modal?.kind === 'edit'
          ? renderForm(slug, modal.kind === 'edit' ? modal.record : undefined, () => setModal(null))
          : null}
      </Modal>

      {modal?.kind === 'deactivate' ? (
        <DeactivateMasterDialog
          meta={meta}
          record={modal.record}
          recordLabel={recordLabel(meta.slug, modal.record)}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

/** A human-friendly label for a record (its code or primary reason). */
function recordLabel(slug: MasterSlug, record: MasterRecordView): string {
  if (slug === 'rejection-reasons') return humanize((record as RejectionReasonView).primaryReason);
  return (record as RegionView | BranchView | BusinessCalendarView).code;
}

/** Pick the resource-specific form for the create/edit Modal. */
function renderForm(slug: MasterSlug, record: MasterRecordView | undefined, onClose: () => void): JSX.Element {
  switch (slug) {
    case 'regions':
      return <RegionForm region={record as RegionView | undefined} onClose={onClose} />;
    case 'branches':
      return <BranchForm branch={record as BranchView | undefined} onClose={onClose} />;
    case 'rejection-reasons':
      return <RejectionReasonForm reason={record as RejectionReasonView | undefined} onClose={onClose} />;
    case 'business-calendars':
      return <BusinessCalendarForm calendar={record as BusinessCalendarView | undefined} onClose={onClose} />;
  }
}

interface RowActions {
  onEdit: (record: MasterRecordView) => void;
  onDeactivate: (record: MasterRecordView) => void;
}

/** Resource-specific columns plus a shared status + actions column. */
function buildColumns(
  meta: MasterResourceMeta,
  canManage: boolean,
  actions: RowActions,
): DataTableColumn<MasterRecordView>[] {
  const cols: DataTableColumn<MasterRecordView>[] = [...DATA_COLUMNS[meta.slug]];

  if (meta.activeness === 'boolean') {
    cols.push({
      id: 'isActive',
      header: 'Status',
      cell: (r) => (
        <StatusChip label={r.isActive ? 'Active' : 'Inactive'} tone={r.isActive ? 'success' : 'neutral'} />
      ),
    });
  }

  cols.push({
    id: 'actions',
    header: '',
    cell: (r) =>
      canManage ? (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => actions.onEdit(r)}>
            Edit
          </Button>
          {meta.activeness === 'boolean' && r.isActive ? (
            <Button variant="ghost" size="sm" onClick={() => actions.onDeactivate(r)}>
              Deactivate
            </Button>
          ) : null}
        </div>
      ) : null,
  });

  return cols;
}

/** The data (non-status, non-action) columns per resource, mirroring descriptors. */
const DATA_COLUMNS: Readonly<Record<MasterSlug, DataTableColumn<MasterRecordView>[]>> = {
  regions: [
    { id: 'code', header: 'Code', cell: (r) => (r as RegionView).code },
    { id: 'name', header: 'Name', cell: (r) => (r as RegionView).name },
  ],
  branches: [
    { id: 'code', header: 'Code', cell: (r) => (r as BranchView).code },
    { id: 'name', header: 'Name', cell: (r) => (r as BranchView).name },
    {
      id: 'pinCodes',
      header: 'PIN codes',
      cell: (r) => {
        const pins = (r as BranchView).pinCodes;
        return pins && pins.length > 0 ? pins.join(', ') : '—';
      },
    },
  ],
  'rejection-reasons': [
    {
      id: 'primaryReason',
      header: 'Primary reason',
      cell: (r) => humanize((r as RejectionReasonView).primaryReason),
    },
    { id: 'subReason', header: 'Sub reason', cell: (r) => (r as RejectionReasonView).subReason ?? '—' },
    {
      id: 'requiresRemarks',
      header: 'Requires remarks',
      cell: (r) => ((r as RejectionReasonView).requiresRemarks ? 'Yes' : 'No'),
    },
  ],
  'business-calendars': [
    { id: 'code', header: 'Code', cell: (r) => (r as BusinessCalendarView).code },
    { id: 'name', header: 'Name', cell: (r) => (r as BusinessCalendarView).name },
    { id: 'timezone', header: 'Timezone', cell: (r) => (r as BusinessCalendarView).timezone },
  ],
};
