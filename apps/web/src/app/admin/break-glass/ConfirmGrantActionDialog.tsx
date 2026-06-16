import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { isApiClientError } from '@/lib/api';
import { useApproveBreakGlass, useRevokeBreakGlass } from '@/hooks/use-break-glass';
import type { BreakGlassGrantListItem } from '@/types/break-glass';

/**
 * FR-003 §UI — four-eyes confirm dialog for the approve / revoke transitions on a
 * break-glass grant. Mirrors {@link DeactivateUserDialog}: a Modal with a clear
 * description and a single confirm button; the server is authoritative and any
 * `FORBIDDEN` (e.g. four-eyes: the caller is the grantee, or is not the nominated
 * approver) / `CONFLICT` (grant no longer awaiting / revocable) is surfaced inline
 * via `role="alert"`, not just a toast, so the reason is visible in place.
 */
type Action = 'approve' | 'revoke';

const COPY: Readonly<
  Record<
    Action,
    {
      title: string;
      description: string;
      confirmLabel: string;
      success: string;
      forbidden: string;
      conflict: string;
      generic: string;
      destructive: boolean;
    }
  >
> = {
  approve: {
    title: 'Approve break-glass grant',
    description:
      'Confirm you are approving this emergency access. You cannot approve a grant where you are the grantee (four-eyes).',
    confirmLabel: 'Approve grant',
    success: 'Break-glass grant approved and active.',
    forbidden: 'You cannot approve this grant. The approver must differ from the grantee, and only the nominated approver may approve.',
    conflict: 'This grant is no longer awaiting approval. Refresh and retry.',
    generic: 'Could not approve the grant. Please try again.',
    destructive: false,
  },
  revoke: {
    title: 'Revoke break-glass grant',
    description: 'The grantee will lose emergency access immediately. This action is recorded in the audit trail.',
    confirmLabel: 'Revoke grant',
    success: 'Break-glass grant revoked.',
    forbidden: "You don't have permission to revoke this grant.",
    conflict: 'This grant can no longer be revoked. Refresh and retry.',
    generic: 'Could not revoke the grant. Please try again.',
    destructive: true,
  },
};

export function ConfirmGrantActionDialog({
  action,
  grant,
  onClose,
}: {
  action: Action;
  grant: BreakGlassGrantListItem;
  onClose: () => void;
}): JSX.Element {
  const approve = useApproveBreakGlass();
  const revoke = useRevokeBreakGlass();
  const [formError, setFormError] = React.useState<string | null>(null);

  const copy = COPY[action];
  const mutation = action === 'approve' ? approve : revoke;

  async function handleConfirm(): Promise<void> {
    setFormError(null);
    try {
      await mutation.mutateAsync(grant.grantId);
      toast.success(copy.success);
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'FORBIDDEN') {
        setFormError(copy.forbidden);
        return;
      }
      if (isApiClientError(error) && error.code === 'CONFLICT') {
        setFormError(copy.conflict);
        return;
      }
      if (isApiClientError(error) && error.code === 'NOT_FOUND') {
        setFormError('This grant no longer exists. Refresh the list.');
        return;
      }
      setFormError(copy.generic);
    }
  }

  return (
    <Modal open onClose={onClose} title={copy.title} description={copy.description}>
      <div className="space-y-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Grantee</dt>
            <dd className="font-mono">{grant.granteeId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Scope</dt>
            <dd>
              {grant.scopeType}
              {grant.scopeRef ? ` · ${grant.scopeRef}` : ''}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="max-w-[60%] text-right">{grant.reason}</dd>
          </div>
        </dl>

        {formError ? (
          <p role="alert" aria-live="polite" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={copy.destructive ? 'destructive' : 'default'}
            disabled={mutation.isPending}
            onClick={() => void handleConfirm()}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {copy.confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
