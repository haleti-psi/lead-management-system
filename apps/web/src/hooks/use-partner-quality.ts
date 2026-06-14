import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient, type QueryParams } from '@/lib/api';
import type { PartnerQualityData } from '@/types/partner-quality';

/** FR-092 — `GET /partners/{id}/quality` (computed score + factor breakdown). */
export function usePartnerQuality(
  partnerId: string,
  from?: string,
  to?: string,
): UseQueryResult<PartnerQualityData> {
  return useQuery({
    queryKey: ['partner-quality', partnerId, from ?? null, to ?? null],
    enabled: Boolean(partnerId),
    queryFn: ({ signal }) => {
      const query: QueryParams = {};
      if (from) query.from = from;
      if (to) query.to = to;
      return apiClient.get<PartnerQualityData>(`/partners/${partnerId}/quality`, { query, signal });
    },
  });
}
