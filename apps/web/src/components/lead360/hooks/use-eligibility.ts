import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api';

/**
 * FR-080 — eligibility snapshot shape returned by
 * POST /api/v1/leads/{id}/eligibility.
 */
export interface EligibilitySnapshot {
  eligibilitySnapshotId: string;
  leadId: string;
  requestRef: string;
  status: 'pending' | 'received' | 'failed';
  indicativeAmount: string | null;
  tenureMonths: number | null;
  rateRange: string | null;
  conditions: Record<string, unknown> | null;
  validityUntil: string | null;
  responseBasis: 'indicative' | 'preliminary' | 'final' | null;
  createdAt: string;
}

/**
 * FR-080 — polls the latest eligibility snapshot via Lead 360's eligibility
 * section (GET /api/v1/leads/:id/eligibility). Polls every 15 s while
 * status === 'pending' (LLD §Data fetching).
 *
 * NOTE: the GET endpoint is the internal read-path surfaced by the Lead 360
 * aggregate (FR-051); it is not a standalone FR-080 POST endpoint.
 */
export function useEligibilitySnapshot(
  leadId: string,
  initialStatus?: EligibilitySnapshot['status'],
): UseQueryResult<EligibilitySnapshot | null> {
  return useQuery({
    queryKey: ['eligibility', leadId],
    queryFn: () =>
      apiClient
        .get<EligibilitySnapshot | null>(`/leads/${leadId}/eligibility/snapshot`)
        .catch(() => null),
    staleTime: 5_000,
    refetchInterval: initialStatus === 'pending' ? 15_000 : false,
  });
}

/**
 * FR-080 — mutation that triggers POST /api/v1/leads/:id/eligibility.
 * Returns the snapshot (pending or received) on success.
 */
export function useRequestEligibility(leadId: string): UseMutationResult<EligibilitySnapshot, Error, string | undefined> {
  return useMutation({
    mutationFn: (idempotencyKey?: string) =>
      apiClient.post<EligibilitySnapshot>(
        `/leads/${leadId}/eligibility`,
        undefined,
        idempotencyKey
          ? { headers: { 'Idempotency-Key': idempotencyKey } }
          : undefined,
      ),
  });
}
