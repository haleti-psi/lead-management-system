import { DocStatus, KycStatus } from '@lms/shared';
import type { ChipTone } from '@/components/ui/StatusChip';

interface Display {
  label: string;
  tone: ChipTone;
}

/** `doc_status` → chip label + tone (LLD §UI: StatusChip over doc_status). */
const DOC_STATUS_DISPLAY: Readonly<Record<DocStatus, Display>> = {
  [DocStatus.NOT_REQUIRED]: { label: 'Not required', tone: 'neutral' },
  [DocStatus.PENDING]: { label: 'Pending', tone: 'neutral' },
  [DocStatus.UPLOADED]: { label: 'Uploaded', tone: 'info' },
  [DocStatus.UNDER_REVIEW]: { label: 'Under review', tone: 'progress' },
  [DocStatus.VERIFIED]: { label: 'Verified', tone: 'success' },
  [DocStatus.MISMATCH]: { label: 'Mismatch', tone: 'danger' },
  [DocStatus.WAIVED]: { label: 'Waived', tone: 'warning' },
  [DocStatus.EXPIRED]: { label: 'Expired', tone: 'danger' },
};

/** `kyc_status` → chip label + tone (checklist summary). */
const KYC_STATUS_DISPLAY: Readonly<Record<KycStatus, Display>> = {
  [KycStatus.NOT_STARTED]: { label: 'Not started', tone: 'neutral' },
  [KycStatus.IN_PROGRESS]: { label: 'In progress', tone: 'progress' },
  [KycStatus.VERIFIED]: { label: 'Verified', tone: 'success' },
  [KycStatus.EXCEPTION]: { label: 'Exception', tone: 'danger' },
  [KycStatus.WAIVED]: { label: 'Waived', tone: 'warning' },
};

export function docStatusDisplay(status: DocStatus): Display {
  return DOC_STATUS_DISPLAY[status] ?? { label: status, tone: 'neutral' };
}

export function kycStatusDisplay(status: KycStatus): Display {
  return KYC_STATUS_DISPLAY[status] ?? { label: status, tone: 'neutral' };
}
