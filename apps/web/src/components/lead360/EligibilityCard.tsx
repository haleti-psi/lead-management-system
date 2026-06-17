/**
 * FR-080 — EligibilityCard (read-only).
 *
 * Renders inside the Lead 360 view. The card is ALWAYS read-only; no inline
 * editing. Polled every 15 s while status = 'pending' (LLD §UI Component Tree).
 *
 * Supported states (LLD §UI Component Tree):
 * - no snapshot yet  → EmptyState + RequestEligibilityButton
 * - status=pending   → LoadingSkeleton + "Awaiting LOS response"
 * - status=received  → EligibilityDetails + indicative badge
 * - status=failed    → ErrorState + RetryButton
 * - terminal stage   → DisabledOverlay (no request button)
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { EligibilityDetails } from './EligibilityDetails';
import { useEligibilitySnapshot, useRequestEligibility } from './hooks/use-eligibility';
import type { EligibilitySnapshot } from './hooks/use-eligibility';

/** Stages that prevent triggering an eligibility check. */
const TERMINAL_STAGES = new Set(['handed_off', 'rejected']);

export interface EligibilityCardProps {
  leadId: string;
  leadStage: string;
  /** Whether the lead has a granted product_eligibility consent. */
  consentPresent: boolean;
  /** Initial snapshot from the Lead 360 aggregate (FR-051), if any. */
  initialSnapshot?: EligibilitySnapshot | null;
}

export function EligibilityCard({
  leadId,
  leadStage,
  consentPresent,
  initialSnapshot,
}: EligibilityCardProps): JSX.Element {
  const isTerminal = TERMINAL_STAGES.has(leadStage);
  const [submitting, setSubmitting] = useState(false);

  const { data: snapshot, refetch } = useEligibilitySnapshot(
    leadId,
    initialSnapshot?.status,
  );

  const resolved = snapshot ?? initialSnapshot ?? null;

  const mutation = useRequestEligibility(leadId);

  const handleRequest = async () => {
    setSubmitting(true);
    try {
      await mutation.mutateAsync(undefined);
      toast.success('Eligibility request submitted.');
      void refetch();
    } catch {
      toast.error('Could not trigger eligibility check. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Terminal stage overlay ────────────────────────────────────────────────
  if (isTerminal) {
    return (
      <section aria-label="Eligibility" className="relative rounded-lg border p-4">
        <p className="text-sm font-medium">Eligibility</p>
        <div className="pointer-events-none mt-2 select-none opacity-40" aria-hidden>
          {resolved ? <EligibilityDetails snapshot={resolved} /> : <p className="text-sm text-muted-foreground">No eligibility check performed.</p>}
        </div>
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 text-sm text-muted-foreground">
          This lead is in a terminal stage — no further eligibility checks are permitted.
        </div>
      </section>
    );
  }

  // ── No snapshot yet ────────────────────────────────────────────────────────
  if (!resolved) {
    return (
      <section aria-label="Eligibility" className="rounded-lg border p-4">
        <p className="text-sm font-medium">Eligibility</p>
        <EmptyState
          title="No eligibility check yet"
          message={consentPresent ? 'Request an LOS eligibility check below.' : 'Consent for product eligibility check has not been captured.'}
          action={
            consentPresent && leadStage === 'kyc_in_progress' ? (
              <Button
                size="sm"
                onClick={handleRequest}
                disabled={submitting}
                aria-label="Request eligibility check"
              >
                {submitting ? 'Submitting…' : 'Request Eligibility'}
              </Button>
            ) : null
          }
        />
      </section>
    );
  }

  // ── Pending ────────────────────────────────────────────────────────────────
  if (resolved.status === 'pending') {
    return (
      <section aria-label="Eligibility" className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <p className="text-sm font-medium">Eligibility</p>
          <span role="status" aria-live="polite"><StatusChip status="pending" label="Eligibility status" /></span>
        </div>
        <LoadingSkeleton rows={3} />
        <p className="mt-2 text-xs text-muted-foreground">Awaiting LOS response…</p>
      </section>
    );
  }

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (resolved.status === 'failed') {
    return (
      <section aria-label="Eligibility" className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <p className="text-sm font-medium">Eligibility</p>
          <StatusChip status="failed" label="Eligibility status" />
        </div>
        <ErrorState
          title="LOS unavailable"
          message="Service temporarily unavailable. Retrying shortly."
          onRetry={submitting ? undefined : handleRequest}
        />
      </section>
    );
  }

  // ── Received ───────────────────────────────────────────────────────────────
  const isFinal = resolved.responseBasis === 'final';

  return (
    <section aria-label="Eligibility" className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <p className="text-sm font-medium">Eligibility</p>
        <span role="status" aria-live="polite"><StatusChip status="received" label="Eligibility status" /></span>
        {!isFinal ? (
          <StatusChip tone="warning" label="Indicative" />
        ) : (
          <StatusChip tone="success" label="Final" />
        )}
      </div>
      <EligibilityDetails snapshot={resolved} />
    </section>
  );
}
