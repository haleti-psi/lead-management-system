import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn, type SortState } from '@/components/data/DataTable';
import { PartnerForm } from '@/components/partner/PartnerForm';
import { useCan } from '@/lib/auth/capabilities';
import { usePartners } from '@/hooks/use-partners';
import type { PartnerView } from '@/types/partner';
import { PartnerStatusDialog } from './PartnerStatusDialog';
import { PartnerDetailDialog } from './PartnerDetailDialog';
import { STATUS_ACTION_LABEL, STATUS_TONE, transitionsFrom } from './partner-status';

/** DataTable column id → server sort field (LLD §GET sort allow-list). */
const SORT_FIELD: Readonly<Record<string, string>> = {
  legalName: 'legal_name',
  validUntil: 'valid_until',
  qualityScore: 'quality_score',
  createdAt: 'created_at',
};

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; partner: PartnerView }
  | { mode: 'detail'; partner: PartnerView }
  | { mode: 'status'; partner: PartnerView; target: string }
  | null;

/**
 * FR-090 §UI — Partner Management at `/admin/partners` (ADMIN/HEAD/BM with the
 * `configuration` capability). Server-paginated, filterable list; create/edit via
 * a modal form; read-only detail with a link to the partner's quality dashboard;
 * and status-machine transitions (suspend / reactivate / expire) via a confirm
 * dialog that captures a reason and surfaces invalid-transition errors. Masked
 * contact mobile, status chips, loading/error/empty states. The server remains
 * authoritative for scope and the ADMIN/HEAD-only status-change rule.
 */
export function PartnerManagementPage(): JSX.Element {
  const can = useCan();
  const canManage = can('configuration');

  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [status, setStatus] = React.useState('');
  const [type, setType] = React.useState('');
  const [modal, setModal] = React.useState<ModalState>(null);

  const sortParam = sort ? `${SORT_FIELD[sort.columnId] ?? 'created_at'}:${sort.dir}` : 'created_at:desc';
  const queryResult = usePartners(
    { page, limit, sort: sortParam, status: status || undefined, type: type || undefined },
    canManage,
  );
  const result = queryResult.data;

  // Partner management is `configuration`-only; don't render the table (or fetch)
  // for users without the capability (the server also enforces FORBIDDEN).
  if (!canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Partner Management</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don't have access to partner management.
        </p>
      </div>
    );
  }

  const columns: DataTableColumn<PartnerView>[] = [
    { id: 'partnerCode', header: 'Code', cell: (p) => p.partnerCode },
    {
      id: 'legalName',
      header: 'Legal Name',
      sortable: true,
      cell: (p) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          onClick={() => setModal({ mode: 'detail', partner: p })}
        >
          {p.legalName}
        </button>
      ),
    },
    { id: 'type', header: 'Type', cell: (p) => <StatusChip label={p.type} tone="info" /> },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => <StatusChip label={p.status} tone={STATUS_TONE[p.status] ?? 'neutral'} />,
    },
    { id: 'riskCategory', header: 'Risk', cell: (p) => p.riskCategory ?? '—' },
    { id: 'qualityScore', header: 'Quality', cell: (p) => p.qualityScore ?? '—', sortable: true },
    { id: 'contactMobile', header: 'Mobile', cell: (p) => p.contactMobile ?? '—' },
    { id: 'validUntil', header: 'Valid Until', cell: (p) => p.validUntil ?? '—', sortable: true },
    {
      id: 'createdAt',
      header: 'Created',
      sortable: true,
      cell: (p) => new Date(p.createdAt).toLocaleDateString(),
    },
    {
      id: 'actions',
      header: '',
      className: 'text-right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setModal({ mode: 'edit', partner: p })}>
            Edit
          </Button>
          {transitionsFrom(p.status).map((target) => (
            <Button
              key={target}
              variant="ghost"
              size="sm"
              onClick={() => setModal({ mode: 'status', partner: p, target })}
            >
              {STATUS_ACTION_LABEL[target]}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Partner Management</h1>
        <Button onClick={() => setModal({ mode: 'create' })}>
          <Plus className="h-4 w-4" aria-hidden />
          Add Partner
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'expired', label: 'Expired' },
          ]}
        />
        <FilterSelect
          label="Type"
          value={type}
          onChange={(v) => { setType(v); setPage(1); }}
          options={[
            { value: '', label: 'All types' },
            ...['DSA', 'Dealer', 'Connector', 'OEM', 'Aggregator', 'Referral'].map((t) => ({ value: t, label: t })),
          ]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(p) => p.partnerId}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => { setLimit(l); setPage(1); }}
        sort={sort}
        onSortChange={setSort}
        isLoading={queryResult.isLoading}
        error={queryResult.isError ? 'Could not load partners.' : null}
        onRetry={() => void queryResult.refetch()}
        emptyTitle="No partners found"
        emptyMessage="No partners match the current filters."
      />

      <Modal
        open={modal?.mode === 'create' || modal?.mode === 'edit'}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit partner' : 'Add partner'}
      >
        {modal?.mode === 'edit' ? (
          <PartnerForm partner={modal.partner} onClose={() => setModal(null)} />
        ) : modal?.mode === 'create' ? (
          <PartnerForm onClose={() => setModal(null)} />
        ) : null}
      </Modal>

      {modal?.mode === 'detail' ? (
        <PartnerDetailDialog partner={modal.partner} onClose={() => setModal(null)} />
      ) : null}

      {modal?.mode === 'status' ? (
        <PartnerStatusDialog
          partner={modal.partner}
          target={modal.target}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}): JSX.Element {
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
