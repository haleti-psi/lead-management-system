import { PartnerStatus } from '@lms/shared';
import type { ChipTone } from '@/components/ui/StatusChip';

/**
 * FR-090 §State Machine — client mirror of the partner status machine used to
 * gate UI affordances. The server (PartnerService) remains authoritative for
 * every transition; this only decides which action buttons to offer so the user
 * is never shown an action that would always be rejected.
 *
 * Valid transitions (state-machines.md §Partner; PARTNER_STATUS_TRANSITIONS):
 *   active    → suspended | expired
 *   suspended → active (reactivate) | expired
 *   expired   → (none — terminal)
 */
export const PARTNER_STATUS_TRANSITIONS: Readonly<Record<string, readonly PartnerStatus[]>> = {
  [PartnerStatus.ACTIVE]: [PartnerStatus.SUSPENDED, PartnerStatus.EXPIRED],
  [PartnerStatus.SUSPENDED]: [PartnerStatus.ACTIVE, PartnerStatus.EXPIRED],
  [PartnerStatus.EXPIRED]: [],
};

/** Statuses whose change requires a `statusReason` (LLD §Validation — suspend /
 * expire only; reactivation may carry an optional reason). */
export const STATUS_REASON_REQUIRED: ReadonlySet<string> = new Set<string>([
  PartnerStatus.SUSPENDED,
  PartnerStatus.EXPIRED,
]);

/** Status chip colour (ui.md §States — active=green, suspended=amber, expired=red). */
export const STATUS_TONE: Readonly<Record<string, ChipTone>> = {
  [PartnerStatus.ACTIVE]: 'success',
  [PartnerStatus.SUSPENDED]: 'warning',
  [PartnerStatus.EXPIRED]: 'danger',
};

/** The action verb shown on the button / dialog for a target status. */
export const STATUS_ACTION_LABEL: Readonly<Record<string, string>> = {
  [PartnerStatus.ACTIVE]: 'Reactivate',
  [PartnerStatus.SUSPENDED]: 'Suspend',
  [PartnerStatus.EXPIRED]: 'Expire',
};

/** The transitions available from `current`, in display order. */
export function transitionsFrom(current: string): readonly PartnerStatus[] {
  return PARTNER_STATUS_TRANSITIONS[current] ?? [];
}
