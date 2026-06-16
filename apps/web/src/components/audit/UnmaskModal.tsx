import { useEffect, useId, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/textarea';
import { isApiClientError } from '@/lib/api';
import { useUnmaskAudit } from '@/hooks/use-audit';
import type { UnmaskableDetailField } from '@/types/audit';

/** The audit row + masked field a reveal targets. */
export interface UnmaskTarget {
  auditId: string;
  field: UnmaskableDetailField;
}

export interface UnmaskModalProps {
  /** The target field, or null when the modal is closed. */
  target: UnmaskTarget | null;
  onClose: () => void;
}

/** Server requires a 10–500 char justification; mirror the lower bound here. */
const MIN_REASON = 10;
const MAX_REASON = 500;

/**
 * FR-123 — privileged single-field unmask dialog (LLD §UI + security.md). Opening
 * it for a masked PII cell requires the operator to type a justification
 * (≥10 chars) before the reveal is allowed; on confirm it calls
 * `POST /audit/unmask` (which audits the reveal itself and enforces an active
 * break-glass grant — a 403 if none is held). The revealed raw value is shown
 * TRANSIENTLY inside the dialog and is discarded the moment it closes; it is
 * never written back into the table. Exactly one field on one row — never bulk.
 *
 * Accessibility: built on the shared {@link Modal} (focus trap, Escape, restore);
 * the reason field has a visible label and `aria-invalid`/`aria-describedby`
 * wiring; the revealed value and any error are announced via live regions.
 */
export function UnmaskModal({ target, onClose }: UnmaskModalProps): JSX.Element | null {
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const mutation = useUnmaskAudit();
  const errorId = useId();
  const revealId = useId();

  // Reset all transient state whenever the target changes (open/close/retarget),
  // so a previous reveal/reason can never leak into the next field.
  useEffect(() => {
    setReason('');
    setRevealed(null);
    setTouched(false);
    mutation.reset();
    // mutation is stable from react-query; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.auditId, target?.field]);

  if (target == null) return null;

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON;
  const showReasonError = touched && !reasonValid;

  function fieldErrorMessage(): string {
    const err = mutation.error;
    if (isApiClientError(err)) {
      if (err.status === 403) return 'A break-glass grant is required to reveal this value.';
      return err.message;
    }
    return "Couldn't reveal this value. Please try again.";
  }

  async function handleConfirm(): Promise<void> {
    setTouched(true);
    if (!reasonValid || target == null) return;
    try {
      const result = await mutation.mutateAsync({
        audit_id: target.auditId,
        field: target.field,
        reason: trimmed,
      });
      // Empty/absent fields come back as null — show an explicit marker rather
      // than a blank so the operator knows the reveal succeeded but had no value.
      setRevealed(result.value ?? '(empty)');
    } catch {
      // Surfaced via mutation.isError below; no raw cause is shown to the user.
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reveal masked value"
      description={`Field: ${target.field}. This reveal is recorded in the audit trail.`}
    >
      {revealed == null ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="unmask-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="unmask-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={MAX_REASON}
              aria-required="true"
              aria-invalid={showReasonError || undefined}
              aria-describedby={showReasonError ? errorId : undefined}
              placeholder="Why is this reveal necessary? (minimum 10 characters)"
            />
            {showReasonError ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                Please enter a reason of at least {MIN_REASON} characters.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {trimmed.length}/{MAX_REASON} characters. A justification is mandatory and audited.
              </p>
            )}
          </div>

          {mutation.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {fieldErrorMessage()}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!reasonValid || mutation.isPending}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Eye className="h-4 w-4" aria-hidden />
              )}
              Reveal value
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Revealed value</p>
            <p
              id={revealId}
              role="status"
              className="break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm"
            >
              {revealed}
            </p>
            <p className="text-sm text-muted-foreground">
              Shown once. This value is not stored and will disappear when you close this dialog.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
