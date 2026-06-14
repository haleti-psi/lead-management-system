import type { KycCheckStatus, KycException, KycType } from '@lms/shared';

/**
 * FR-071 — `POST /leads/{id}/kyc/{type}` response (LLD §Response). Masked fields
 * ONLY: `masked_response` already holds the masked summary; the raw provider
 * payload, `pan_token`, and `aadhaar_ref_token` are NEVER serialised (TC-017).
 */
export interface KycVerificationData {
  kycVerificationId: string;
  leadId: string;
  kycType: KycType;
  status: KycCheckStatus;
  reference: string | null;
  maskedResponse: Record<string, unknown> | null;
  exceptionType: KycException | null;
  createdAt: Date;
}
