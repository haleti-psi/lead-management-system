import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { ResolveKycExceptionData, ResolveKycExceptionBody } from '@/types/kyc';

export interface ResolveKycInput {
  kycVerificationId: string;
  body: ResolveKycExceptionBody;
}

/**
 * FR-072 — `PATCH /leads/{id}/kyc/{kid}/resolve` (LLD §Endpoint). Resolves an
 * open KYC exception; the response `status` is the mapped enum value
 * (`success`/`waived` — no `resolved` enum, AMBIGUITY FR-072-A5).
 */
export function useResolveKycException(
  leadId: string,
): UseMutationResult<ResolveKycExceptionData, unknown, ResolveKycInput> {
  return useMutation({
    mutationFn: ({ kycVerificationId, body }: ResolveKycInput) =>
      apiClient.patch<ResolveKycExceptionData>(`/leads/${leadId}/kyc/${kycVerificationId}/resolve`, body),
  });
}
