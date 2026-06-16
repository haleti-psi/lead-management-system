import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type {
  CreateSavedViewBody,
  LeadListFilters,
  LeadListItem,
  LeadListParams,
  SavedView,
} from '@/types/lead';

export const leadKeys = {
  all: ['leads'] as const,
  list: (params: LeadListParams) => ['leads', params] as const,
};

export const savedViewKeys = {
  all: ['saved-views'] as const,
  list: (page: number, limit: number) => ['saved-views', page, limit] as const,
};

/** Serialise the allow-listed filters into bracketed `filter[<key>]` query keys
 * (the api-contract `GET /leads` filter grammar; same convention as `usePartners`).
 * Only defined values are emitted; booleans go over the wire as `'true'/'false'`. */
function toFilterQuery(filters: LeadListFilters): QueryParams {
  const query: QueryParams = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    query[`filter[${key}]`] = typeof value === 'boolean' ? String(value) : value;
  }
  return query;
}

/**
 * FR-050 — `GET /leads` (scope-filtered, masked, server-paginated). Uses
 * `getPage` so the DataTable receives `meta.pagination`. `q` is the free-text
 * search; filters are sent as `filter[<key>]`; `sort` is `<field>:<dir>`.
 */
export function useLeads(params: LeadListParams): UseQueryResult<PageResult<LeadListItem>> {
  return useQuery({
    queryKey: leadKeys.list(params),
    queryFn: ({ signal }) => {
      const query: QueryParams = {
        page: params.page,
        limit: params.limit,
        sort: params.sort,
        ...toFilterQuery(params.filters),
      };
      if (params.q) query.q = params.q;
      return apiClient.getPage<LeadListItem>('/leads', { query, signal });
    },
  });
}

/** FR-050 — `GET /saved-views` (own ∪ in-scope shared work queues). */
export function useSavedViews(page = 1, limit = 100): UseQueryResult<PageResult<SavedView>> {
  return useQuery({
    queryKey: savedViewKeys.list(page, limit),
    queryFn: ({ signal }) =>
      apiClient.getPage<SavedView>('/saved-views', { query: { page, limit }, signal }),
  });
}

/** FR-050 — `POST /saved-views` (persist the current filter preset). */
export function useCreateSavedView(): UseMutationResult<SavedView, unknown, CreateSavedViewBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSavedViewBody) => apiClient.post<SavedView>('/saved-views', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}
