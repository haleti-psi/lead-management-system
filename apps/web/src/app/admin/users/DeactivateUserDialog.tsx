import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Modal } from '@/components/ui/Modal';
import { isApiClientError } from '@/lib/api';
import { useAdminUsers, useUpdateUser } from '@/hooks/use-admin-users';
import type { UserView } from '@/types/admin';

/**
 * FR-130 §UI — confirm deactivating a user (audited destructive action). The user
 * must type a reason (a deliberate-action gate; the audit row itself is written
 * server-side from the transition, so the reason is not sent as a body field —
 * UpdateUserDto has none). If the backend reports open leads
 * (CONFLICT + `detail.open_lead_count`), a reassignment target becomes required
 * and the dialog re-submits with `reassign_to`. The whole reassign + deactivate
 * is one atomic server transaction.
 */
export function DeactivateUserDialog({
  user,
  onClose,
}: {
  user: UserView;
  onClose: () => void;
}): JSX.Element {
  const update = useUpdateUser();
  const [reason, setReason] = React.useState('');
  const [reassignTo, setReassignTo] = React.useState('');
  const [openLeadCount, setOpenLeadCount] = React.useState<number | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Active users (excluding this one) are the eligible reassignment targets. Only
  // fetched once reassignment is required (open leads were reported).
  const reassignRequired = openLeadCount != null && openLeadCount > 0;
  const usersQuery = useAdminUsers(
    { page: 1, limit: 100, sort: '-created_at', status: 'active' },
    reassignRequired,
  );
  const candidates = (usersQuery.data?.data ?? []).filter((u) => u.user_id !== user.user_id);

  const reasonValid = reason.trim().length >= 3;
  const canSubmit = reasonValid && (!reassignRequired || reassignTo.length > 0) && !update.isPending;

  async function handleConfirm(): Promise<void> {
    setFormError(null);
    if (!reasonValid) {
      setFormError('Enter a reason (at least 3 characters) to confirm.');
      return;
    }
    if (reassignRequired && !reassignTo) {
      setFormError('Select a user to receive the open leads.');
      return;
    }
    try {
      await update.mutateAsync({
        userId: user.user_id,
        body: { status: 'inactive', ...(reassignTo ? { reassign_to: reassignTo } : {}) },
      });
      toast.success('User deactivated.');
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'CONFLICT') {
        const count = Number(error.detail?.open_lead_count ?? 0);
        setOpenLeadCount(Number.isFinite(count) && count > 0 ? count : 1);
        setFormError(
          'This user owns open leads. Choose a user to receive them, then confirm again.',
        );
        return;
      }
      if (isApiClientError(error) && error.code === 'FORBIDDEN') {
        setFormError("You don't have access to deactivate this user.");
        return;
      }
      setFormError('Could not deactivate the user. Please try again.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Deactivate ${user.full_name}`}
      description="The user will lose access immediately. This action is recorded in the audit trail."
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="deactivate-reason">
            Reason
            <span className="text-destructive" aria-hidden>
              {' *'}
            </span>
          </Label>
          <Textarea
            id="deactivate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            aria-required
            aria-invalid={formError && !reasonValid ? true : undefined}
            placeholder="Why is this user being deactivated?"
          />
        </div>

        {reassignRequired ? (
          <div className="space-y-1.5">
            <Label htmlFor="deactivate-reassign">
              Reassign open leads to
              <span className="text-destructive" aria-hidden>
                {' *'}
              </span>
            </Label>
            <p className="text-sm text-muted-foreground">
              {openLeadCount} open lead{openLeadCount === 1 ? '' : 's'} will be reassigned.
            </p>
            <select
              id="deactivate-reassign"
              aria-required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
            >
              <option value="">Select a user…</option>
              {candidates.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name} ({u.username})
                </option>
              ))}
            </select>
          </div>
        ) : null}

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
            variant="destructive"
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
          >
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Deactivate user
          </Button>
        </div>
      </div>
    </Modal>
  );
}
