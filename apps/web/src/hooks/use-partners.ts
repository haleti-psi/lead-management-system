import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type { CreatePartnerBody, PartnerView, UpdatePartnerBody } from '@/types/partner';

export interface PartnerListParams {
  page: number;
  limit: number;
  sort: string;
  status?: string;
  type?: string;
}

export const partnerKeys = {
  all: ['partners'] as const,
  list: (params: PartnerListParams) => ['partners', params] as const,
};

/** FR-090 — `GET /partners` (server-paginated). Uses `getPage` so the DataTable
 * receives `meta.pagination`. Filters are sent as `filter[status]`/`filter[type]`. */
export function usePartners(
  params: PartnerListParams,
  enabled = true,
): UseQueryResult<PageResult<PartnerView>> {
  return useQuery({
    queryKey: partnerKeys.list(params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit, sort: params.sort };
      if (params.status) query['filter[status]'] = params.status;
      if (params.type) query['filter[type]'] = params.type;
      return apiClient.getPage<PartnerView>('/partners', { query, signal });
    },
  });
}

export function useCreatePartner(): UseMutationResult<unknown, unknown, CreatePartnerBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePartnerBody) => apiClient.post('/partners', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: partnerKeys.all }),
  });
}

export interface UpdatePartnerInput {
  partnerId: string;
  body: UpdatePartnerBody;
}

export function useUpdatePartner(): UseMutationResult<unknown, unknown, UpdatePartnerInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, body }: UpdatePartnerInput) => apiClient.patch(`/partners/${partnerId}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: partnerKeys.all }),
  });
}
