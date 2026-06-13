import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

/**
 * FR-051 — status badge for stage / KYC / consent / duplicate values.
 *
 * NOTE: `shared-utilities.md` lists `StatusChip` as a shared web component, but
 * the merged web foundation does not provide one yet (see AMBIGUITY.md) — this
 * is the workspace-local stand-in, built only on Tailwind tokens so it can be
 * promoted to `components/common/` unchanged. Each chip exposes
 * `data-status="<value>"` (UI-051-06) and keeps text/background contrast at
 * AA (≥ 4.5:1) using the 800-on-100 palette pairs.
 */
export type StatusTone = 'neutral' | 'positive' | 'progress' | 'warning' | 'negative';

const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-slate-100 text-slate-800',
  positive: 'bg-green-100 text-green-800',
  progress: 'bg-blue-100 text-blue-800',
  warning: 'bg-amber-100 text-amber-800',
  negative: 'bg-red-100 text-red-800',
};

/** Domain status value → tone (workspace defaults; unknown values stay neutral). */
const STATUS_TONES: Readonly<Record<string, StatusTone>> = {
  // Lead stages
  captured: 'neutral',
  consent_pending: 'warning',
  assigned: 'progress',
  first_contact_pending: 'warning',
  contacted: 'progress',
  qualified: 'progress',
  documents_pending: 'warning',
  kyc_in_progress: 'progress',
  eligibility_requested: 'progress',
  ready_for_handoff: 'positive',
  handed_off: 'positive',
  rejected: 'negative',
  dormant: 'neutral',
  // KYC status
  not_started: 'neutral',
  in_progress: 'progress',
  verified: 'positive',
  exception: 'negative',
  waived: 'neutral',
  // Consent status ('captured' shares the lead-stage key — neutral default)
  pending: 'warning',
  partial: 'warning',
  withdrawn: 'negative',
  // Duplicate status
  none: 'neutral',
  flagged: 'warning',
  linked: 'progress',
  merged: 'neutral',
  // Consent ledger states
  granted: 'positive',
  denied: 'negative',
  expired: 'warning',
  superseded: 'neutral',
  // Eligibility / generic
  received: 'positive',
  failed: 'negative',
  open: 'warning',
  resolved: 'positive',
  active: 'positive',
};

export interface StatusChipProps {
  /** The raw status value (enum literal); rendered with `_` → space. */
  status: string;
  /** Visually-hidden context for screen readers, e.g. "KYC status". */
  label?: string;
  /** Explicit tone override; defaults to the domain map (else neutral). */
  tone?: StatusTone;
  className?: string;
}

export function StatusChip({ status, label, tone, className }: StatusChipProps): ReactElement {
  const resolvedTone = tone ?? STATUS_TONES[status] ?? 'neutral';
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[resolvedTone],
        className,
      )}
    >
      {label ? <span className="sr-only">{label}: </span> : null}
      {status.replaceAll('_', ' ')}
    </span>
  );
}
