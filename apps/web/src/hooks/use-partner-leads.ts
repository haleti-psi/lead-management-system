import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type { PartnerLeadCreateBody, PartnerLeadCreateView, PartnerLeadView } from '@/types/partner-lead';

export interface PartnerLeadListParams {
  page: number;
  limit: number;
  stage?: string;
  q?: string;
}

export const partnerLeadKeys = {
  all: ['partner-leads'] as const,
  list: (params: PartnerLeadListParams) => ['partner-leads', params] as const,
};

/** FR-091 — `GET /partners/leads` (the partner's own leads, server-paginated). */
export function usePartnerLeads(params: PartnerLeadListParams): UseQueryResult<PageResult<PartnerLeadView>> {
  return useQuery({
    queryKey: partnerLeadKeys.list(params),
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit };
      if (params.stage) query.stage = params.stage;
      if (params.q) query.q = params.q;
      return apiClient.getPage<PartnerLeadView>('/partners/leads', { query, signal });
    },
  });
}

/** FR-091 — `POST /partners/leads`. Sends a per-submit Idempotency-Key so retries
 * are safe (the server replays the original lead). */
export function useSubmitPartnerLead(): UseMutationResult<PartnerLeadCreateView, unknown, PartnerLeadCreateBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PartnerLeadCreateBody) =>
      apiClient.post<PartnerLeadCreateView>('/partners/leads', body, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: partnerLeadKeys.all }),
  });
}
