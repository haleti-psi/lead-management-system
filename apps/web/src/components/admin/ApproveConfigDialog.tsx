import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/StatusChip';
import { useApproveConfig } from '@/hooks/use-config-governance';
import type { ApproveConfigResult, ConfigDecision } from '@/types/config-governance';
import { DiffViewer } from './DiffViewer';
import { actionErrorMessage, humanizeStatus, statusTone } from './config-governance-utils';

const COMMENT_MAX = 500;

/**
 * FR-132 — checker review for a pending `configuration_versions` row
 * (`POST /admin/config/{id}/approve`). The checker chooses Approve or Reject and
 * may add a comment (≤500). On success the returned version (including its diff)
 * is shown so the operator can confirm what changed; on failure the maker-checker
 * errors are surfaced in-dialog: self-approval / out-of-scope → FORBIDDEN,
 * already-acted → CONFLICT, unknown id → NOT_FOUND.
 *
 * No GET-by-id endpoint exists, so the diff is unavailable until AFTER a
 * successful approval (the action response carries it). For a rejection the
 * version is not activated and no diff is returned.
 */
export function ApproveConfigDialog({
  versionId,
  onClose,
}: {
  versionId: string;
  onClose: () => void;
}): JSX.Element {
  const approve = useApproveConfig();
  const [decision, setDecision] = React.useState<ConfigDecision>('approved');
  const [comment, setComment] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ApproveConfigResult | null>(null);

  const commentInvalid = comment.length > COMMENT_MAX;

  async function submit(): Promise<void> {
    setError(null);
    if (commentInvalid) {
      setError('Comment must not exceed 500 characters.');
      return;
    }
    try {
      const data = await approve.mutateAsync({
        versionId,
        body: { action: decision, comment: comment.trim() ? comment.trim() : undefined },
      });
      setResult(data);
      toast.success(decision === 'approved' ? 'Configuration approved.' : 'Configuration rejected.');
    } catch (err) {
      setError(actionErrorMessage(err));
    }
  }

  // After a successful action, show the outcome (status + diff) read-only.
  if (result) {
    return (
      <Modal open onClose={onClose} title="Configuration change reviewed">
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Config type</dt>
            <dd className="font-medium">{result.configType}</dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-medium tabular-nums">{result.version}</dd>
            <dt className="text-muted-foreground">New status</dt>
            <dd>
              <StatusChip label={humanizeStatus(result.status)} tone={statusTone(result.status)} />
            </dd>
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-medium">Change details</h3>
            <DiffViewer diff={result.diff} />
          </div>
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
      title="Review configuration change"
      description="Approve or reject this pending change. You cannot approve a change you submitted."
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Decision</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="config-decision"
                className="h-4 w-4"
                checked={decision === 'approved'}
                onChange={() => setDecision('approved')}
              />
              Approve
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="config-decision"
                className="h-4 w-4"
                checked={decision === 'rejected'}
                onChange={() => setDecision('rejected')}
              />
              Reject
            </label>
          </div>
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="config-comment" className="text-sm font-medium">
            Comment <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="config-comment"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={comment}
            maxLength={COMMENT_MAX + 1}
            aria-invalid={commentInvalid}
            aria-describedby="config-comment-help"
            onChange={(e) => setComment(e.target.value)}
          />
          <p id="config-comment-help" className="text-xs text-muted-foreground">
            {comment.length}/{COMMENT_MAX}
          </p>
        </div>

        {error ? (
          <p role="alert" aria-live="assertive" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={approve.isPending}>
            Cancel
          </Button>
          <Button
            variant={decision === 'rejected' ? 'destructive' : 'default'}
            onClick={() => void submit()}
            disabled={approve.isPending || commentInvalid}
          >
            {decision === 'rejected' ? 'Reject change' : 'Approve change'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
