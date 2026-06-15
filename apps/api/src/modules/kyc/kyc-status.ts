import { KycCheckStatus, KycStatus } from '@lms/shared';

/** The fields of a kyc_verifications row the lead-status derivation reads. */
export interface KycStatusRow {
  status: KycCheckStatus;
  resolution_code: string | null;
}

/**
 * Derive `leads.kyc_status` from a lead's KYC verification rows (FR-071
 * §computeLeadKycStatus; shared with FR-072 exception resolution so both agree).
 *
 * An OPEN exception is `status='exception'` OR an unresolved `status='failed'`
 * (FR-071 persists provider mismatch/down as `failed` with an `exception_type`;
 * the `failed→exception` transition consumer is unbuilt — AMBIGUITY FR-072-A4).
 * A resolved exception (FR-072) becomes `success` or `waived` — there is no
 * `resolved` enum value (AMBIGUITY FR-072-A5) — so it no longer counts as open.
 */
export function deriveLeadKycStatus(rows: KycStatusRow[]): KycStatus {
  if (rows.length === 0) return KycStatus.NOT_STARTED;

  const hasOpenException = rows.some(
    (r) =>
      r.status === KycCheckStatus.EXCEPTION ||
      (r.status === KycCheckStatus.FAILED && r.resolution_code === null),
  );
  if (hasOpenException) return KycStatus.EXCEPTION;

  if (rows.every((r) => r.status === KycCheckStatus.WAIVED)) return KycStatus.WAIVED;
  if (rows.every((r) => r.status === KycCheckStatus.SUCCESS || r.status === KycCheckStatus.WAIVED)) {
    return KycStatus.VERIFIED;
  }
  return KycStatus.IN_PROGRESS;
}
