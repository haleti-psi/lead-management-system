import * as React from 'react';
import { Plus, ShieldOff } from 'lucide-react';
import { GrantStatus } from '@lms/shared';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCan } from '@/lib/auth/capabilities';
import { useAuth } from '@/hooks/use-auth';
import { useBreakGlassGrants } from '@/hooks/use-break-glass';
import type { BreakGlassGrantListItem } from '@/types/break-glass';
import { RequestGrantModal } from './RequestGrantModal';
import { ConfirmGrantActionDialog } from './ConfirmGrantActionDialog';

/** grant_status → StatusChip tone (ui.md §States; LLD §UI Component Tree). */
const STATUS_TONE: Readonly<Record<GrantStatus, ChipTone>> = {
  [GrantStatus.PENDING]: 'progress',
  [GrantStatus.ACTIVE]: 'success',
  [GrantStatus.EXPIRED]: 'neutral',
  [GrantStatus.REVOKED]: 'danger',
};

type ActionState =
  | { kind: 'request' }
  | { kind: 'approve'; grant: BreakGlassGrantListItem }
  | { kind: 'revoke'; grant: BreakGlassGrantListItem }
  | null;

const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: GrantStatus.PENDING, label: 'Pending' },
  { value: GrantStatus.ACTIVE, label: 'Active' },
  { value: GrantStatus.EXPIRED, label: 'Expired' },
  { value: GrantStatus.REVOKED, label: 'Revoked' },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/**
 * FR-003 §UI — Break-Glass privileged access console, mounted at
 * `/admin/break-glass` (capability `break_glass`; ADMIN and DPO). Lists the org's
 * grants (server-paginated, optional status filter) in a {@link DataTable}, with a
 * Request-grant modal and four-eyes Approve / Revoke confirm dialogs. All
 * affordances are gated by `useCan('break_glass')`; the server's AbacGuard remains
 * authoritative for every action.
 */
export function BreakGlassPage(): JSX.Element {
  const can = useCan();
  const { user } = useAuth();
  const canBreakGlass = can('break_glass');

  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [status, setStatus] = React.useState('');
  const [action, setAction] = React.useState<ActionState>(null);

  const query = useBreakGlassGrants(
    { page, limit, status: status ? (status as GrantStatus) : undefined },
    canBreakGlass,
  );
  const result = query.data;

  if (!canBreakGlass) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Break-Glass Access</h1>
        <EmptyState
          icon={<ShieldOff className="h-8 w-8" aria-hidden />}
          title="No access"
          message="You don't have access to break-glass administration."
        />
      </div>
    );
  }

  const columns: DataTableColumn<BreakGlassGrantListItem>[] = [
    { id: 'granteeId', header: 'Grantee', cell: (g) => <span className="font-mono text-xs">{g.granteeId}</span> },
    {
      id: 'scope',
      header: 'Scope',
      cell: (g) => (
        <span>
          {g.scopeType}
          {g.scopeRef ? <span className="ml-1 font-mono text-xs text-muted-foreground">{g.scopeRef}</span> : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (g) => <StatusChip label={g.status} tone={STATUS_TONE[g.status] ?? 'neutral'} />,
    },
    { id: 'validUntil', header: 'Valid until', cell: (g) => formatWhen(g.validUntil) },
    { id: 'reason', header: 'Reason', cell: (g) => <span className="line-clamp-2 max-w-xs">{g.reason}</span> },
    {
      id: 'actions',
      header: '',
      cell: (g) => {
        const canApprove = g.status === GrantStatus.PENDING;
        const canRevoke = g.status === GrantStatus.PENDING || g.status === GrantStatus.ACTIVE;
        if (!canApprove && !canRevoke) return null;
        return (
          <div className="flex justify-end gap-1">
            {canApprove ? (
              <Button variant="ghost" size="sm" onClick={() => setAction({ kind: 'approve', grant: g })}>
                Approve
              </Button>
            ) : null}
            {canRevoke ? (
              <Button variant="ghost" size="sm" onClick={() => setAction({ kind: 'revoke', grant: g })}>
                Revoke
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Break-Glass Access"
        description="Time-boxed emergency elevated access — every grant needs four-eyes approval."
        actions={
          <Button onClick={() => setAction({ kind: 'request' })}>
            <Plus className="h-4 w-4" aria-hidden />
            Request grant
          </Button>
        }
      />

      <label className="flex items-center gap-1 text-sm">
        <span className="sr-only">Filter by status</span>
        <select
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {STATUS_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(g) => g.grantId}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={query.isLoading}
        error={query.isError ? 'Could not load break-glass grants.' : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No grants found"
        emptyMessage="No break-glass grants match the current filter."
      />

      <Modal
        open={action?.kind === 'request'}
        onClose={() => setAction(null)}
        title="Request break-glass access"
        description="Create a time-boxed emergency grant. A different ADMIN/DPO must approve it (four-eyes)."
      >
        {action?.kind === 'request' ? (
          <RequestGrantModal currentUserId={user?.userId ?? ''} onClose={() => setAction(null)} />
        ) : null}
      </Modal>

      {action?.kind === 'approve' || action?.kind === 'revoke' ? (
        <ConfirmGrantActionDialog
          action={action.kind}
          grant={action.grant}
          onClose={() => setAction(null)}
        />
      ) : null}
    </div>
  );
}
