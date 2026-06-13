import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api';
import type { Lead360Response } from './lead360.types';

/**
 * FR-051 — fetches the Lead-360 aggregate (`GET /api/v1/leads/:id`) through
 * the foundation apiClient (auth + envelope handling). 30 s staleTime per the
 * LLD §Data fetching — fresh enough for operational use; refetches on focus.
 */
export function useLead360(leadId: string): UseQueryResult<Lead360Response> {
  return useQuery({
    queryKey: ['lead360', leadId],
    queryFn: () => apiClient.get<Lead360Response>(`/leads/${leadId}`),
    staleTime: 30_000,
  });
}
