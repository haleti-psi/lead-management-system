import { cn } from '@/lib/utils';

/**
 * Canonical status chip (ui.md §States) — the single shared chip across the app.
 *
 * Two call styles are supported:
 *  • tone-driven (presentational): `<StatusChip label="Verified" tone="success" />`
 *    — `label` is the visible text.
 *  • status-driven (domain): `<StatusChip status="kyc_in_progress" label="KYC status" />`
 *    — the visible text is the status (`_`→space); `label` becomes a
 *    screen-reader-only context prefix; `data-status` is emitted; and the tone is
 *    resolved from the domain map unless an explicit `tone` is given.
 *
 * Palette is semantic and AA in light + dark: in-progress/info = blue,
 * success/positive = green, warning = amber, danger/negative = red, neutral = muted.
 */
export type ChipTone =
  | 'neutral'
  | 'info'
  | 'progress'
  | 'success'
  | 'positive'
  | 'warning'
  | 'danger'
  | 'negative';

const TONE_CLASSES: Readonly<Record<ChipTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  progress: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  positive: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  negative: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};

/** Domain status value → tone (used when a `status` is given without an explicit tone). */
const STATUS_TONES: Readonly<Record<string, ChipTone>> = {
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
  // Consent status
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
  /** Visible text (tone-driven style). When `status` is set, this becomes the sr-only context. */
  label?: string;
  /** Domain status value; sets `data-status`, drives the visible text + default tone. */
  status?: string;
  /** Explicit tone override; otherwise resolved from `status` (else neutral). */
  tone?: ChipTone;
  className?: string;
}

export function StatusChip({ label, status, tone, className }: StatusChipProps): JSX.Element {
  const resolvedTone = tone ?? (status ? STATUS_TONES[status] : undefined) ?? 'neutral';
  const visible = status ? status.replaceAll('_', ' ') : (label ?? '');
  const srContext = status ? label : undefined;
  return (
    <span
      {...(status ? { 'data-status': status } : {})}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        // tone-driven labels are Title-cased; domain status text stays as-is (e.g. "kyc in progress")
        status ? undefined : 'capitalize',
        TONE_CLASSES[resolvedTone],
        className,
      )}
    >
      {srContext ? <span className="sr-only">{srContext}: </span> : null}
      {visible}
    </span>
  );
}
