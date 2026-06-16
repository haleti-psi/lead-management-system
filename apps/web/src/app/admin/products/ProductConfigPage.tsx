import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn, type SortState } from '@/components/data/DataTable';
import { ErrorState } from '@/components/common/ErrorState';
import { useCan } from '@/lib/auth/capabilities';
import {
  useProductConfig,
  useProductConfigs,
  type ProductConfigListParams,
} from '@/hooks/use-product-configs';
import { ProductConfigForm } from '@/components/product-config/ProductConfigForm';
import { RetireProductConfigDialog } from '@/components/product-config/RetireProductConfigDialog';
import { PRODUCT_CODE_OPTIONS, PAN_TIMING_OPTIONS } from '@/components/product-config/product-config-form-schema';
import type { ProductConfigListRow } from '@/types/product-config';

/** config_status → chip tone (draft = neutral, active = success, retired = danger). */
const STATUS_TONE: Readonly<Record<string, ChipTone>> = {
  draft: 'neutral',
  active: 'success',
  retired: 'danger',
};

/** PanTiming value → human label (reuse the form's option labels). */
const PAN_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  PAN_TIMING_OPTIONS.map((o) => [o.value, o.label]),
);

/** DataTable column id → server sort field (LLD §1 allow-list: created_at, version, name). */
const SORT_FIELD: Readonly<Record<string, string>> = {
  name: 'name',
  version: 'version',
  updatedAt: 'created_at',
};

type ModalState =
  | { kind: 'create' }
  | { kind: 'edit'; row: ProductConfigListRow }
  | { kind: 'retire'; row: ProductConfigListRow }
  | null;

/**
 * FR-040 §UI — Product Configuration administration, mounted at `/admin/products`
 * (capability `configuration`). A server-paginated, filterable DataTable of product
 * configs; create a new draft or edit an active config (which submits a NEW draft
 * version) through a Modal form; retire an active config via a confirm dialog.
 *
 * Every change is a maker step in the FR-132 maker-checker flow — it lands as a
 * pending `configuration_versions` row and does not go live until a checker
 * approves it (approval lives elsewhere; this screen does not activate configs).
 * Affordances are gated by `useCan('configuration')`; the server stays authoritative.
 */
export function ProductConfigPage(): JSX.Element {
  const can = useCan();
  const canManage = can('configuration');

  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [status, setStatus] = React.useState('');
  const [productCode, setProductCode] = React.useState('');
  const [modal, setModal] = React.useState<ModalState>(null);

  const signedSort = sort
    ? `${sort.dir === 'desc' ? '-' : ''}${SORT_FIELD[sort.columnId] ?? 'created_at'}`
    : '-created_at';
  const params: ProductConfigListParams = {
    page,
    limit,
    sort: signedSort,
    status: status || undefined,
    productCode: productCode || undefined,
  };
  const queryResult = useProductConfigs(params, canManage);
  const result = queryResult.data;

  // Configuration is `configuration`-only; don't fetch or render the table for
  // users without it (the server also enforces FORBIDDEN).
  if (!canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Product Configurations</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don't have access to product configuration.
        </p>
      </div>
    );
  }

  const columns: DataTableColumn<ProductConfigListRow>[] = [
    { id: 'productCode', header: 'Product', cell: (r) => r.product_code },
    { id: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
    { id: 'version', header: 'Version', cell: (r) => `v${r.version}`, sortable: true },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusChip label={r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} />,
    },
    { id: 'panRequiredAt', header: 'PAN required at', cell: (r) => PAN_LABEL[r.pan_required_at] ?? r.pan_required_at },
    {
      id: 'updatedAt',
      header: 'Last updated',
      cell: (r) => new Date(r.updated_at).toLocaleDateString(),
      sortable: true,
    },
    {
      id: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setModal({ kind: 'edit', row: r })}>
            {r.status === 'active' ? 'Edit' : 'View'}
          </Button>
          {r.status === 'active' ? (
            <Button variant="ghost" size="sm" onClick={() => setModal({ kind: 'retire', row: r })}>
              Retire
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Product Configurations</h1>
        <Button onClick={() => setModal({ kind: 'create' })}>
          <Plus className="h-4 w-4" aria-hidden />
          New configuration
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'draft', label: 'Draft' },
            { value: 'active', label: 'Active' },
            { value: 'retired', label: 'Retired' },
          ]}
        />
        <FilterSelect
          label="Product"
          value={productCode}
          onChange={(v) => {
            setProductCode(v);
            setPage(1);
          }}
          options={[{ value: '', label: 'All products' }, ...PRODUCT_CODE_OPTIONS]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(r) => r.product_config_id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        sort={sort}
        onSortChange={setSort}
        isLoading={queryResult.isLoading}
        error={queryResult.isError ? 'Could not load product configurations.' : null}
        onRetry={() => void queryResult.refetch()}
        emptyTitle="No product configurations found"
        emptyMessage="No configurations match the current filters."
      />

      <Modal
        open={modal?.kind === 'create' || modal?.kind === 'edit'}
        onClose={() => setModal(null)}
        title={modal?.kind === 'edit' ? 'Product configuration' : 'New product configuration'}
      >
        {modal?.kind === 'create' ? <ProductConfigForm onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'edit' ? (
          <EditFormLoader row={modal.row} onClose={() => setModal(null)} />
        ) : null}
      </Modal>

      {modal?.kind === 'retire' ? (
        <RetireProductConfigDialog config={modal.row} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}

/** Fetches the full config (with JSONB payloads) for the edit form. */
function EditFormLoader({
  row,
  onClose,
}: {
  row: ProductConfigListRow;
  onClose: () => void;
}): JSX.Element {
  const { data, isLoading, isError, refetch } = useProductConfig(row.product_config_id);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading configuration…
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState message="Could not load this configuration." onRetry={() => void refetch()} />;
  }
  return <ProductConfigForm config={data} onClose={onClose} />;
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
