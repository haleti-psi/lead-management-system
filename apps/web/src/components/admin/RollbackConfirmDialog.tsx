import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { useRollbackConfig } from '@/hooks/use-config-governance';
import type { RollbackConfigResult } from '@/types/config-governance';
import { actionErrorMessage } from './config-governance-utils';

const REASON_MAX = 500;

/**
 * FR-132 — destructive rollback of an ACTIVE `configuration_versions` row
 * (`POST /admin/config/{id}/rollback`). A reason (1–500 chars) is mandatory.
 * Rolling back re-activates the prior `rollback_ref` version; the response says
 * which version (if any) was restored. CONFLICT (not active / already rolled
 * back) and NOT_FOUND (unknown id) are surfaced in-dialog.
 */
export function RollbackConfirmDialog({
  versionId,
  onClose,
}: {
  versionId: string;
  onClose: () => void;
}): JSX.Element {
  const rollback = useRollbackConfig();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<RollbackConfigResult | null>(null);

  const trimmed = reason.trim();
  const reasonInvalid = trimmed.length === 0 || reason.length > REASON_MAX;

  async function confirm(): Promise<void> {
    setError(null);
    if (reasonInvalid) {
      setError('A reason is required and must not exceed 500 characters.');
      return;
    }
    try {
      const data = await rollback.mutateAsync({ versionId, body: { reason: trimmed } });
      setResult(data);
      toast.success('Configuration rolled back.');
    } catch (err) {
      setError(actionErrorMessage(err));
    }
  }

  if (result) {
    return (
      <Modal open onClose={onClose} title="Configuration rolled back">
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-medium">{result.configType}</span> was rolled back.
          </p>
          <p className="text-sm text-muted-foreground">
            {result.restoredVersionId
              ? 'The previously active version has been restored.'
              : 'There was no prior version to restore.'}
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Roll back configuration"
      description="This deactivates the current version and re-activates the previous one. This cannot be undone."
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="rollback-reason" className="text-sm font-medium">
            Reason <span className="text-destructive">*</span>
          </label>
          <textarea
            id="rollback-reason"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={reason}
            maxLength={REASON_MAX + 1}
            required
            aria-invalid={reason.length > 0 && reasonInvalid}
            aria-describedby="rollback-reason-help"
            onChange={(e) => setReason(e.target.value)}
          />
          <p id="rollback-reason-help" className="text-xs text-muted-foreground">
            {reason.length}/{REASON_MAX}
          </p>
        </div>

        {error ? (
          <p role="alert" aria-live="assertive" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={rollback.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={rollback.isPending || reasonInvalid}
          >
            Roll back
          </Button>
        </div>
      </div>
    </Modal>
  );
}
