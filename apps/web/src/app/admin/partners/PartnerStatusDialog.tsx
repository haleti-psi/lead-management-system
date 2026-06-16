import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isApiClientError } from '@/lib/api';
import { useUpdatePartner } from '@/hooks/use-partners';
import type { PartnerView } from '@/types/partner';
import { readConflictReason } from '@/app/admin/master/forms/form-utils';
import { STATUS_ACTION_LABEL, STATUS_REASON_REQUIRED } from './partner-status';

/**
 * FR-090 §State Machine — confirm a partner status transition (suspend /
 * reactivate / expire) via `PATCH /partners/{id}` with `{ status, statusReason }`.
 *
 * - Suspend / expire require a reason (LLD §Validation); reactivate makes it
 *   optional. The button is disabled until a required reason is entered, and the
 *   server still enforces the rule.
 * - Server rejections are surfaced INLINE (not dismissed) so the operator sees
 *   why: an invalid transition arrives as `VALIDATION_ERROR` with a `status`
 *   field issue (PartnerService), a stale-state clash as `CONFLICT`, and a
 *   scope/role denial as `FORBIDDEN`. Only ADMIN/HEAD may change status server-
 *   side; the page already gates the affordance, this is the safety net.
 */
export function PartnerStatusDialog({
  partner,
  target,
  onClose,
}: {
  partner: PartnerView;
  /** The status to transition to (already validated as a legal next state). */
  target: string;
  onClose: () => void;
}): JSX.Element {
  const update = useUpdatePartner();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const action = STATUS_ACTION_LABEL[target] ?? 'Update status';
  const reasonRequired = STATUS_REASON_REQUIRED.has(target);
  const reasonId = React.useId();
  const errorId = React.useId();

  async function confirm(): Promise<void> {
    setError(null);
    try {
      await update.mutateAsync({
        partnerId: partner.partnerId,
        body: {
          status: target,
          ...(reason.trim() ? { statusReason: reason.trim() } : {}),
        },
      });
      toast.success(`Partner ${action.toLowerCase()}d.`);
      onClose();
    } catch (err) {
      if (isApiClientError(err)) {
        if (err.code === 'VALIDATION_ERROR') {
          const statusIssue = err.fields?.find((f) => f.field === 'status')?.issue;
          setError(statusIssue ?? err.message);
          return;
        }
        if (err.code === 'CONFLICT') {
          setError(
            readConflictReason(err.detail) ??
              'This partner has changed since you loaded it. Refresh and retry.',
          );
          return;
        }
        if (err.code === 'FORBIDDEN') {
          setError("You don't have access to change this partner's status.");
          return;
        }
      }
      setError(`Could not ${action.toLowerCase()} the partner. Please try again.`);
    }
  }

  const submitDisabled = update.isPending || (reasonRequired && reason.trim().length === 0);

  return (
    <Modal open onClose={onClose} title={`${action} partner`}>
      <div className="space-y-4">
        <p className="text-sm">
          {action} <span className="font-medium">{partner.legalName}</span>{' '}
          <span className="text-muted-foreground">({partner.partnerCode})</span>?
          {target === 'active'
            ? ' The partner will be able to submit leads again.'
            : ' The partner will be blocked from submitting new leads.'}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor={reasonId}>
            Reason
            {reasonRequired ? (
              <span className="text-destructive" aria-hidden>
                {' *'}
              </span>
            ) : (
              <span className="text-muted-foreground"> (optional)</span>
            )}
          </Label>
          <Textarea
            id={reasonId}
            rows={3}
            maxLength={500}
            value={reason}
            aria-required={reasonRequired || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              reasonRequired ? 'e.g. Compliance review pending' : 'Add an optional note'
            }
          />
        </div>

        {error ? (
          <p
            id={errorId}
            role="alert"
            aria-live="assertive"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={target === 'active' ? 'default' : 'destructive'}
            onClick={() => void confirm()}
            disabled={submitDisabled}
          >
            {action}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
