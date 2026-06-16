import * as React from 'react';
import { CheckSquare, Info, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/auth/capabilities';
import { ApproveConfigDialog } from './ApproveConfigDialog';
import { RollbackConfirmDialog } from './RollbackConfirmDialog';

/** RFC-4122 UUID (any version) — mirrors the backend `ConfigIdParam` guard so a
 * malformed id is caught before the request is sent. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DialogState = { kind: 'approve'; versionId: string } | { kind: 'rollback'; versionId: string } | null;

/**
 * FR-132 §UI — Configuration Governance (maker-checker), intended to mount at
 * `/admin/config` (capability `configuration`). A checker approves/rejects a
 * pending `configuration_versions` change, or rolls back an active one; each
 * action runs in its own transaction server-side and emits `CONFIG_CHANGED`.
 *
 * IMPORTANT — backend surface: the API (`ConfigGovernanceController`) exposes
 * ONLY `POST /admin/config/{id}/approve` and `POST /admin/config/{id}/rollback`.
 * There is NO endpoint to LIST pending versions and NO GET-by-id. So this screen
 * cannot render a server-paginated queue or fetch a diff up front (the diff is
 * returned by the approve action). Until a list endpoint exists, the operator
 * acts on a known configuration-version id (e.g. from the change notification /
 * audit trail). This limitation is called out in the page banner and the report.
 *
 * Affordances are gated by `useCan('configuration')`; the server's
 * `EntitlementService.can()` plus the scope-A and maker≠checker guards remain
 * authoritative (a denied action surfaces FORBIDDEN/CONFLICT in the dialog).
 */
export function ConfigGovernancePage(): JSX.Element {
  const can = useCan();
  const canManage = can('configuration');

  const [versionId, setVersionId] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogState>(null);

  const trimmed = versionId.trim();
  const idValid = UUID_RE.test(trimmed);
  const showIdError = touched && trimmed.length > 0 && !idValid;

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

  function open(kind: 'approve' | 'rollback'): void {
    setTouched(true);
    if (!idValid) return;
    setDialog({ kind, versionId: trimmed });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configuration Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Maker-checker review of configuration changes. Approve or reject a pending change, or roll back an
          active one.
        </p>
      </div>

      {/* Honest gap notice — no list endpoint exists yet (see page docblock). */}
      <div
        role="note"
        className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          A pending-changes queue is not yet available because the API does not expose a list endpoint. Enter
          the configuration-version id from the change notification or audit trail to act on it.
        </p>
      </div>

      <div className="max-w-xl space-y-3 rounded-md border p-4">
        <div className="space-y-1">
          <label htmlFor="config-version-id" className="text-sm font-medium">
            Configuration version id
          </label>
          <input
            id="config-version-id"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={versionId}
            aria-invalid={showIdError}
            aria-describedby="config-version-id-help"
            onChange={(e) => setVersionId(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          {showIdError ? (
            <p id="config-version-id-help" role="alert" className="text-xs text-destructive">
              Enter a valid configuration-version id (UUID).
            </p>
          ) : (
            <p id="config-version-id-help" className="text-xs text-muted-foreground">
              The id of the configuration_versions row to act on.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => open('approve')} disabled={!idValid}>
            <CheckSquare className="h-4 w-4" aria-hidden />
            Review (approve / reject)
          </Button>
          <Button variant="destructive" onClick={() => open('rollback')} disabled={!idValid}>
            <Undo2 className="h-4 w-4" aria-hidden />
            Roll back
          </Button>
        </div>
      </div>

      {dialog?.kind === 'approve' ? (
        <ApproveConfigDialog versionId={dialog.versionId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'rollback' ? (
        <RollbackConfirmDialog versionId={dialog.versionId} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
