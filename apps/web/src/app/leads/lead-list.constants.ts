import {
  ConsentStatus,
  KycStatus,
  LeadStage,
  Priority,
  ProductCode,
} from '@lms/shared';
import type { ChipTone } from '@/components/ui/StatusChip';
import type { LeadListFilters } from '@/types/lead';

/** A select option (value '' = "all"/unset). */
export interface SelectOption {
  value: string;
  label: string;
}

/** Title-case a snake/lower enum value for display ("documents_pending" → "Documents pending"). */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Lead stage → StatusChip tone (ui.md §States; coarse lifecycle colouring). */
const STAGE_TONE: Readonly<Record<string, ChipTone>> = {
  captured: 'neutral',
  consent_pending: 'progress',
  assigned: 'info',
  first_contact_pending: 'progress',
  contacted: 'info',
  qualified: 'info',
  documents_pending: 'progress',
  kyc_in_progress: 'progress',
  eligibility_requested: 'progress',
  ready_for_handoff: 'success',
  handed_off: 'success',
  rejected: 'danger',
  dormant: 'neutral',
};
export const stageTone = (stage: string): ChipTone => STAGE_TONE[stage] ?? 'neutral';

/** Consent status → tone. */
const CONSENT_TONE: Readonly<Record<string, ChipTone>> = {
  pending: 'progress',
  partial: 'warning',
  captured: 'success',
  withdrawn: 'danger',
};
export const consentTone = (status: string): ChipTone => CONSENT_TONE[status] ?? 'neutral';

/** KYC status → tone. */
const KYC_TONE: Readonly<Record<string, ChipTone>> = {
  not_started: 'neutral',
  in_progress: 'progress',
  verified: 'success',
  exception: 'danger',
  waived: 'info',
};
export const kycTone = (status: string): ChipTone => KYC_TONE[status] ?? 'neutral';

/** DataTable column id → server sort field (LLD §GET sort allow-list). */
export const SORT_FIELD: Readonly<Record<string, string>> = {
  lead_code: 'lead_code',
  stage: 'stage',
  score: 'score',
};

const allOption = (label: string): SelectOption => ({ value: '', label });
const fromEnum = (obj: Readonly<Record<string, string>>): SelectOption[] =>
  Object.values(obj).map((v) => ({ value: v, label: humanise(v) }));

/** Filter-control option lists (built from `@shared/enums` — the single source). */
export const STAGE_OPTIONS: SelectOption[] = [allOption('All stages'), ...fromEnum(LeadStage)];
export const PRODUCT_OPTIONS: SelectOption[] = [
  allOption('All products'),
  ...Object.values(ProductCode).map((v) => ({ value: v, label: v })),
];
export const PRIORITY_OPTIONS: SelectOption[] = [allOption('All priorities'), ...fromEnum(Priority)];
export const CONSENT_OPTIONS: SelectOption[] = [allOption('All consent'), ...fromEnum(ConsentStatus)];
export const KYC_OPTIONS: SelectOption[] = [allOption('All KYC'), ...fromEnum(KycStatus)];
export const SCORE_BAND_OPTIONS: SelectOption[] = [
  allOption('All scores'),
  { value: 'hot', label: 'Hot (≥75)' },
  { value: 'warm', label: 'Warm (50–74)' },
  { value: 'cold', label: 'Cold (<50)' },
  { value: 'unscored', label: 'Unscored' },
];
export const SLA_STATE_OPTIONS: SelectOption[] = [
  allOption('All SLA'),
  { value: 'breached', label: 'Breached' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'ok', label: 'On track' },
  { value: 'none', label: 'No SLA' },
];

/**
 * Built-in work queues (LLD §UI) — client-side filter presets mapped onto the
 * same allow-listed filter grammar. Selecting a chip re-issues `GET /leads`
 * with the preset filters. "My Leads" needs the caller id, so it is injected by
 * the page (kept out of this static table).
 */
export interface QueuePreset {
  id: string;
  label: string;
  filters: LeadListFilters;
}

export const BUILTIN_QUEUES: readonly QueuePreset[] = [
  { id: 'hot', label: 'Hot', filters: { is_hot: true } },
  { id: 'first_contact', label: 'First Contact Pending', filters: { stage: LeadStage.FIRST_CONTACT_PENDING } },
  { id: 'docs_pending', label: 'Docs Pending', filters: { stage: LeadStage.DOCUMENTS_PENDING } },
  { id: 'kyc_pending', label: 'KYC Pending', filters: { stage: LeadStage.KYC_IN_PROGRESS } },
  { id: 'sla_breached', label: 'SLA Breached', filters: { sla_state: 'breached' } },
  { id: 'ready_handoff', label: 'Ready for Handoff', filters: { stage: LeadStage.READY_FOR_HANDOFF } },
  { id: 'rejected', label: 'Rejected', filters: { stage: LeadStage.REJECTED } },
] as const;
