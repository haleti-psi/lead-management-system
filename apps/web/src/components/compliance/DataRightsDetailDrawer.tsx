/**
 * FR-112 — Data Rights Detail Drawer (DPO processing panel).
 *
 * Slide-in panel opened by DataRightsPage on row click. Allows the DPO to:
 *  - Review the request details.
 *  - Transition status (valid next states only).
 *  - Enter a disposition (required for fulfilled / rejected_retained).
 *  - Assign an owner.
 *  - See a LegalHoldAlert when the API returns 409 LEGAL_HOLD.
 *
 * Pattern matches GrievanceDrawer (uses sonner for toasts; Tailwind-only panel;
 * no shadcn Drawer installed yet).
 *
 * LLD §UI Component Tree §DataRightsDetailDrawer.
 */

import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { isApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/workspace/StatusChip';
import { useProcessDataRights } from './use-data-rights';
import {
  RIGHTS_TYPE_LABELS,
  RIGHTS_STATUS_LABELS,
  VALID_NEXT_STATUSES,
  requiresDisposition,
  isTerminalStatus,
  type DataRightsItem,
  type RightsStatus,
} from './data-rights.types';

interface DataRightsDetailDrawerProps {
  /** `null` → drawer is closed. */
  request: DataRightsItem | null;
  onClose: () => void;
  onUpdated: () => void;
}

interface ApiErrorShape {
  detail?: { reason?: string; explanation?: string };
  message?: string;
}

/** Extract LEGAL_HOLD detail from an API error if present. */
function extractLegalHold(err: unknown): { blocked: true; explanation: string } | null {
  if (!isApiClientError(err)) return null;
  const apiErr = err as { error?: ApiErrorShape };
  const detail = apiErr.error?.detail;
  if (detail?.reason === 'LEGAL_HOLD') {
    return {
      blocked: true,
      explanation:
        detail.explanation ??
        'One or more active retention policies have legal_hold=true for this data category.',
    };
  }
  return null;
}

/**
 * Slide-in drawer for a single data-rights request.
 */
export function DataRightsDetailDrawer({
  request,
  onClose,
  onUpdated,
}: DataRightsDetailDrawerProps): JSX.Element {
  const [targetStatus, setTargetStatus] = useState<RightsStatus | ''>('');
  const [disposition, setDisposition] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [legalHoldBlocked, setLegalHoldBlocked] = useState(false);
  const [legalHoldExplanation, setLegalHoldExplanation] = useState('');
  const [dispositionError, setDispositionError] = useState('');

  // Reset form state when the selected request changes
  useEffect(() => {
    setTargetStatus('');
    setDisposition(request?.disposition ?? '');
    setOwnerId(request?.ownerId ?? '');
    setLegalHoldBlocked(false);
    setLegalHoldExplanation('');
    setDispositionError('');
  }, [request?.dataRightsRequestId, request?.disposition, request?.ownerId]);

  // Close on Escape
  useEffect(() => {
    if (!request) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request, onClose]);

  const { mutateAsync, isPending } = useProcessDataRights(
    request?.dataRightsRequestId ?? '',
  );

  if (!request) return <></>;

  const validNext: RightsStatus[] = VALID_NEXT_STATUSES[request.status] ?? [];
  const isTerminal = isTerminalStatus(request.status);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!targetStatus) return;

    if (requiresDisposition(targetStatus) && !disposition.trim()) {
      setDispositionError('Disposition is required when finalising a request.');
      return;
    }
    setDispositionError('');

    try {
      await mutateAsync({
        status: targetStatus,
        disposition: disposition.trim() || undefined,
        ownerId: ownerId.trim() || undefined,
      });
      toast.success('Request updated successfully.');
      onUpdated();
    } catch (err: unknown) {
      const hold = extractLegalHold(err);
      if (hold) {
        setLegalHoldBlocked(true);
        setLegalHoldExplanation(hold.explanation);
        toast.error('Legal hold active — cannot fulfil erasure request.');
      } else {
        const msg = isApiClientError(err) ? err.message : 'Failed to update the request.';
        toast.error(msg);
      }
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/25"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Data Rights Request Detail"
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-white shadow-2xl sm:w-[480px]"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">Data Rights Request</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Request summary */}
          <section className="space-y-2 text-sm text-slate-700">
            <div className="flex gap-2">
              <span className="font-medium w-28 shrink-0">Type:</span>
              <span>{RIGHTS_TYPE_LABELS[request.requestType]}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium w-28 shrink-0">Customer:</span>
              <span
                className="font-mono text-slate-600 truncate"
                title={request.customerProfileId}
              >
                {request.customerProfileId.slice(0, 8)}…
              </span>
            </div>
            {request.leadId && (
              <div className="flex gap-2">
                <span className="font-medium w-28 shrink-0">Lead:</span>
                <span className="font-mono text-slate-600">{request.leadId}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="font-medium w-28 shrink-0">Status:</span>
              <StatusChip status={request.status} label={RIGHTS_STATUS_LABELS[request.status]} />
            </div>
            {request.dueAt && (
              <div className="flex gap-2">
                <span className="font-medium w-28 shrink-0">Due:</span>
                <span>
                  {new Date(request.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              </div>
            )}
            {request.disposition && (
              <div className="flex gap-2">
                <span className="font-medium w-28 shrink-0">Disposition:</span>
                <span className="text-slate-600">{request.disposition}</span>
              </div>
            )}
          </section>

          {/* LegalHoldAlert — shown after 409 LEGAL_HOLD response (LLD §UI UI-03) */}
          {legalHoldBlocked && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              <div className="flex items-center gap-2 font-semibold mb-1">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Legal Hold Active
              </div>
              <p>{legalHoldExplanation}</p>
              <p className="mt-1">
                You may only transition this request to{' '}
                <strong>Rejected / Retained</strong>.
              </p>
            </div>
          )}

          {/* Processing form — only when not terminal */}
          {!isTerminal && (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {/* Status transition select */}
              <div className="space-y-1">
                <label
                  htmlFor="dr-status-select"
                  className="block text-sm font-medium text-slate-700"
                >
                  Transition to
                </label>
                <select
                  id="dr-status-select"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={targetStatus}
                  onChange={(e) => {
                    const v = e.target.value as RightsStatus | '';
                    if (legalHoldBlocked && v !== 'rejected_retained' && v !== '') return;
                    setTargetStatus(v);
                    setDispositionError('');
                  }}
                  aria-label="Select target status"
                >
                  <option value="">Select status…</option>
                  {validNext.map((s) => (
                    <option
                      key={s}
                      value={s}
                      disabled={legalHoldBlocked && s !== 'rejected_retained'}
                    >
                      {RIGHTS_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Disposition textarea */}
              <div className="space-y-1">
                <label
                  htmlFor="dr-disposition"
                  className="block text-sm font-medium text-slate-700"
                >
                  Disposition
                  {targetStatus && requiresDisposition(targetStatus) ? (
                    <span className="text-destructive ml-1" aria-hidden>
                      *
                    </span>
                  ) : null}
                </label>
                <textarea
                  id="dr-disposition"
                  rows={4}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                  maxLength={500}
                  value={disposition}
                  onChange={(e) => {
                    setDisposition(e.target.value);
                    setDispositionError('');
                  }}
                  placeholder="Enter decision basis / reason…"
                  aria-required={targetStatus ? requiresDisposition(targetStatus) : false}
                  aria-describedby={dispositionError ? 'dr-disposition-error' : undefined}
                />
                {dispositionError && (
                  <p
                    id="dr-disposition-error"
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {dispositionError}
                  </p>
                )}
              </div>

              {/* Owner UUID */}
              <div className="space-y-1">
                <label
                  htmlFor="dr-owner-id"
                  className="block text-sm font-medium text-slate-700"
                >
                  Assign Owner (UUID)
                </label>
                <input
                  id="dr-owner-id"
                  type="text"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  placeholder="DPO user UUID (optional)"
                />
              </div>

              {/* Submit */}
              <Button type="submit" disabled={!targetStatus || isPending}>
                {isPending ? 'Saving…' : 'Update Request'}
              </Button>
            </form>
          )}

          {isTerminal && (
            <p className="text-sm text-slate-500">
              This request is in a terminal state and cannot be updated.
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
