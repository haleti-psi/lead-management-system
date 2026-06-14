import type { KycCheckStatus, KycException, KycType } from '@lms/shared';

/**
 * FR-071 wire types — mirror the NestJS KYC DTOs
 * (apps/api/src/modules/kyc/dto/{kyc-verification,run-kyc}.dto.ts). The response
 * carries masked fields only; tokens are never serialised. `createdAt` is an ISO
 * string over the wire.
 */
export interface KycVerificationData {
  kycVerificationId: string;
  leadId: string;
  kycType: KycType;
  status: KycCheckStatus;
  reference: string | null;
  maskedResponse: Record<string, unknown> | null;
  exceptionType: KycException | null;
  createdAt: string;
}

/** Run-KYC request body (consentId optional — the server resolves the active one). */
export interface RunKycBody {
  pan?: string;
  aadhaarOfflineXml?: string;
  digilockerCode?: string;
  consentId?: string;
  idempotencyKey?: string;
}
