import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCan } from '@/lib/auth/capabilities';
import {
  configGovernanceKeys,
  useConfigVersions,
} from '@/hooks/use-config-governance';
import type { PendingConfigVersion } from '@/types/config-governance';
import { ApproveConfigDialog } from './ApproveConfigDialog';
import { RollbackConfirmDialog } from './RollbackConfirmDialog';
import { DiffViewer } from './DiffViewer';
import { humanizeStatus, statusTone } from './config-governance-utils';

type DialogState =
  | { kind: 'diff'; row: PendingConfigVersion }
  | { kind: 'approve'; versionId: string }
  | { kind: 'rollback'; versionId: string }
  | null;

/** "sla_policy" → "Sla policy" for display of the opaque `config_type`. */
function humanizeType(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Short, locale-aware date for the `created` column. */
function formatCreated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * FR-132 §UI — Configuration Governance (maker-checker), mounts at `/admin/config`
 * (capability `configuration`). A checker works a server-paginated queue of
 * `pending` configuration_versions (`GET /admin/config`): each row shows the
 * config type/ref, maker, created time and status, with actions to view the diff
 * and to approve/reject (`ApproveConfigDialog`) or roll back (`RollbackConfirmDialog`).
 * Each action runs in its own transaction server-side and emits `CONFIG_CHANGED`;
 * after a dialog closes the queue is refetched so resolved rows drop out.
 *
 * Affordances are gated by `useCan('configuration')`; the server's
 * `EntitlementService.can()` plus the scope-A and maker≠checker guards remain
 * authoritative (a denied action surfaces FORBIDDEN/CONFLICT in the dialog).
 */
export function ConfigGovernancePage(): JSX.Element {
  const can = useCan();
  const canManage = can('configuration');
  const queryClient = useQueryClient();

  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [dialog, setDialog] = React.useState<DialogState>(null);

  const queryResult = useConfigVersions({ page, limit }, canManage);
  const result = queryResult.data;

  if (!canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Configuration Approvals</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don't have access to configuration governance.
        </p>
      </div>
    );
  }

  /** Close any dialog and refresh the queue so an acted-on row drops out. */
  function closeDialog(): void {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: configGovernanceKeys.all });
  }

  const columns = buildColumns({
    onViewDiff: (row) => setDialog({ kind: 'diff', row }),
    onReview: (row) => setDialog({ kind: 'approve', versionId: row.configurationVersionId }),
    onRollback: (row) => setDialog({ kind: 'rollback', versionId: row.configurationVersionId }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Configuration', to: '/admin' }, { label: 'Approvals' }]}
        title="Configuration Approvals"
        description="Maker-checker review of pending configuration changes — view, then approve, reject, or roll back."
      />

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(r) => r.configurationVersionId}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={queryResult.isLoading}
        error={queryResult.isError ? 'Could not load pending configuration changes.' : null}
        onRetry={() => void queryResult.refetch()}
        emptyTitle="No pending changes"
        emptyMessage="There are no pending configuration changes to review."
      />

      <Modal
        open={dialog?.kind === 'diff'}
        onClose={() => setDialog(null)}
        title="Configuration change details"
      >
        {dialog?.kind === 'diff' ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Config type</dt>
              <dd className="font-medium">{humanizeType(dialog.row.configType)}</dd>
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="font-medium">{dialog.row.configRef ?? '—'}</dd>
            </dl>
            <DiffViewer diff={dialog.row.diff} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>
                Close
              </Button>
              <Button
                onClick={() =>
                  setDialog({ kind: 'approve', versionId: dialog.row.configurationVersionId })
                }
              >
                Review
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {dialog?.kind === 'approve' ? (
        <ApproveConfigDialog versionId={dialog.versionId} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'rollback' ? (
        <RollbackConfirmDialog versionId={dialog.versionId} onClose={closeDialog} />
      ) : null}
    </div>
  );
}

interface RowActions {
  onViewDiff: (row: PendingConfigVersion) => void;
  onReview: (row: PendingConfigVersion) => void;
  onRollback: (row: PendingConfigVersion) => void;
}

/** Queue columns: config type, ref, maker, created, status + a per-row action set. */
function buildColumns(actions: RowActions): DataTableColumn<PendingConfigVersion>[] {
  return [
    {
      id: 'configType',
      header: 'Config type',
      cell: (r) => humanizeType(r.configType),
    },
    {
      id: 'configRef',
      header: 'Reference',
      cell: (r) => r.configRef ?? '—',
    },
    {
      id: 'makerId',
      header: 'Maker',
      cell: (r) => <span className="font-mono text-xs">{r.makerId}</span>,
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (r) => <span className="whitespace-nowrap">{formatCreated(r.createdAt)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusChip label={humanizeStatus(r.status)} tone={statusTone(r.status)} />,
    },
    {
      id: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => actions.onViewDiff(r)}>
            View
          </Button>
          <Button variant="ghost" size="sm" onClick={() => actions.onReview(r)}>
            Approve / Reject
          </Button>
          <Button variant="ghost" size="sm" onClick={() => actions.onRollback(r)}>
            Roll back
          </Button>
        </div>
      ),
    },
  ];
}
