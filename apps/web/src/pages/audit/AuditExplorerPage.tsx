import { useState } from 'react';
import { Eye } from 'lucide-react';

import { MaskedField, type MaskedFieldType } from '@/components/ui/MaskedField';
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { useCan } from '@/lib/auth/capabilities';
import { isApiClientError } from '@/lib/api';
import { useAudit } from '@/hooks/use-audit';
import type {
  AuditFilters,
  AuditItem,
  AuditIntegrityMeta,
  UnmaskableDetailField,
} from '@/types/audit';
import { UNMASKABLE_DETAIL_FIELDS } from '@/types/audit';
import { AuditFilterBar } from '@/components/audit/AuditFilterBar';
import { IntegrityBadge } from '@/components/audit/IntegrityBadge';
import { UnmaskModal, type UnmaskTarget } from '@/components/audit/UnmaskModal';

/**
 * FR-123 — Audit Explorer (M13), intended to mount at `/audit` (capability
 * `audit_trail`; DPO/ADMIN only). A paginated, filterable view over the
 * append-only, hash-chained `audit_logs`. Every row's `detail` arrives masked
 * from the server; the page renders PII via {@link MaskedField} and offers an
 * explicit, reason-gated single-field unmask ({@link UnmaskModal}) — never a bulk
 * reveal. A non-blocking per-page {@link IntegrityBadge} surfaces the hash-chain
 * verdict without ever hiding rows (evidence must always be shown, even when the
 * chain is broken). Loading / empty / error states are mandatory (ui.md §States).
 */

/** Tones for the action chip — coarse semantic grouping (security-sensitive red). */
function actionTone(action: string): ChipTone {
  if (action.includes('failed') || action.includes('deny') || action === 'rejection') return 'danger';
  if (action.startsWith('break_glass') || action.startsWith('config') || action.includes('override')) {
    return 'warning';
  }
  if (action.includes('login') || action.includes('logout')) return 'info';
  return 'neutral';
}

/** Map an unmaskable `detail` key to the {@link MaskedField} display kind. */
const FIELD_KIND: Partial<Record<UnmaskableDetailField, MaskedFieldType>> = {
  mobile: 'mobile',
  pan_token: 'pan',
  aadhaar_ref_token: 'aadhaar',
};

const UNMASKABLE = new Set<string>(UNMASKABLE_DETAIL_FIELDS);

/** Render one masked `detail` entry, with an unmask affordance on PII keys. */
function DetailEntry({
  entryKey,
  value,
  auditId,
  onUnmask,
}: {
  entryKey: string;
  value: unknown;
  auditId: string;
  onUnmask: (target: UnmaskTarget) => void;
}): JSX.Element {
  const text = value == null ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
  const isPii = UNMASKABLE.has(entryKey);
  const kind = FIELD_KIND[entryKey as UnmaskableDetailField];

  return (
    <div className="flex items-baseline gap-1">
      <span className="text-xs font-medium text-muted-foreground">{entryKey}:</span>
      {isPii && kind ? (
        <MaskedField maskedValue={text} fieldType={kind} />
      ) : (
        <span className="text-sm">{text}</span>
      )}
      {isPii ? (
        <button
          type="button"
          aria-label={`Reveal ${entryKey}`}
          className="ml-0.5 inline-flex items-center rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onUnmask({ auditId, field: entryKey as UnmaskableDetailField })}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** The full `detail` cell: a stack of masked key/value entries (or a dash). */
function DetailCell({
  row,
  onUnmask,
}: {
  row: AuditItem;
  onUnmask: (target: UnmaskTarget) => void;
}): JSX.Element {
  const entries = row.detail ? Object.entries(row.detail) : [];
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-md flex-col gap-0.5">
      {entries.map(([k, v]) => (
        <DetailEntry key={k} entryKey={k} value={v} auditId={row.audit_id} onUnmask={onUnmask} />
      ))}
    </div>
  );
}

const NO_INTEGRITY: AuditIntegrityMeta = { badge: 'not_checked', checkedCount: 0, breakAt: null };

export function AuditExplorerPage(): JSX.Element {
  const can = useCan();
  const canView = can('audit_trail');

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [unmaskTarget, setUnmaskTarget] = useState<UnmaskTarget | null>(null);

  const queryResult = useAudit({ filters, page, limit, enabled: canView });
  const result = queryResult.data;

  // Audit explorer is DPO/ADMIN-only; don't render the table (or fetch) without
  // the capability — the server also enforces FORBIDDEN.
  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Audit Explorer</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don't have access to this.
        </p>
      </div>
    );
  }

  const errorMessage =
    queryResult.isError && isApiClientError(queryResult.error)
      ? queryResult.error.status === 403
        ? "You don't have access to this."
        : queryResult.error.message
      : queryResult.isError
        ? 'Could not load the audit trail.'
        : null;

  const columns: DataTableColumn<AuditItem>[] = [
    {
      id: 'created_at',
      header: 'Timestamp',
      cell: (r) => new Date(r.created_at).toLocaleString(),
    },
    { id: 'actor_display', header: 'Actor', cell: (r) => r.actor_display },
    {
      id: 'action',
      header: 'Action',
      cell: (r) => <StatusChip label={r.action} tone={actionTone(r.action)} className="normal-case" />,
    },
    { id: 'entity_type', header: 'Entity Type', cell: (r) => r.entity_type },
    {
      id: 'entity_id',
      header: 'Entity ID',
      cell: (r) => (
        <span className="font-mono text-xs">{r.entity_id ?? '—'}</span>
      ),
    },
    {
      id: 'detail',
      header: 'Detail',
      cell: (r) => <DetailCell row={r} onUnmask={setUnmaskTarget} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Audit Explorer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tamper-evident, hash-chained activity log. Values are masked; reveals are individually audited.
          </p>
        </div>
        <IntegrityBadge integrity={result?.integrity ?? NO_INTEGRITY} />
      </div>

      <AuditFilterBar
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />

      <DataTable
        columns={columns}
        rows={result?.items ?? []}
        getRowId={(r) => r.audit_id}
        pagination={{ page, limit, total: result?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={queryResult.isLoading}
        error={errorMessage}
        onRetry={() => void queryResult.refetch()}
        emptyTitle="No audit records"
        emptyMessage="No activity matches the current filters."
      />

      <UnmaskModal target={unmaskTarget} onClose={() => setUnmaskTarget(null)} />
    </div>
  );
}
