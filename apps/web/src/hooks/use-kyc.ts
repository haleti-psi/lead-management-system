import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { KycType } from '@lms/shared';
import { apiClient } from '@/lib/api';
import type { KycVerificationData, RunKycBody } from '@/types/kyc';

export interface RunKycInput {
  kycType: KycType;
  body: RunKycBody;
}

/**
 * FR-071 — `POST /leads/{id}/kyc/{type}` (LLD §Endpoint). A 200 carries the check
 * result (success or business mismatch → status `failed`); a provider-down 503
 * and a `403 CONSENT_MISSING` reject with an `ApiClientError` the caller maps to
 * the exception/consent banners. There is no KYC list GET in FR-071, so the
 * workbench drives status from these mutation results (AMBIGUITY FR-071-10).
 */
export function useRunKyc(
  leadId: string,
): UseMutationResult<KycVerificationData, unknown, RunKycInput> {
  return useMutation({
    mutationFn: ({ kycType, body }: RunKycInput) =>
      apiClient.post<KycVerificationData>(`/leads/${leadId}/kyc/${kycType}`, body),
  });
}
