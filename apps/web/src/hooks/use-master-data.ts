import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type {
  CreateMasterBody,
  MasterMutationResult,
  MasterRecordView,
  MasterSlug,
  PatchMasterBody,
} from '@/types/master-data';

/**
 * FR-131 — generic master/config data hooks over the `/admin/{masterResource}`
 * endpoints. One hook set serves every allow-listed resource (regions, branches,
 * rejection-reasons, business-calendars); the `slug` parameterises the path and
 * the React Query cache key, so switching resource refetches and create/update
 * invalidate only that resource's lists.
 *
 * Reads use `getPage` so the DataTable receives `meta.pagination`. The optional
 * `is_active` filter is sent as `filter[is_active]` (LLD §GET). All calls go
 * through `apiClient` (uniform envelope, auth, correlation).
 */
export interface MasterListParams {
  page: number;
  limit: number;
  /** When set, filter on the resource's `is_active` column. */
  isActive?: boolean;
}

export const masterDataKeys = {
  resource: (slug: MasterSlug) => ['admin-master', slug] as const,
  list: (slug: MasterSlug, params: MasterListParams) => ['admin-master', slug, params] as const,
};

/** `GET /admin/{slug}` — server-paginated list of one resource. */
export function useMasterList(
  slug: MasterSlug,
  params: MasterListParams,
  enabled = true,
): UseQueryResult<PageResult<MasterRecordView>> {
  return useQuery({
    queryKey: masterDataKeys.list(slug, params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit };
      if (params.isActive !== undefined) query['filter[is_active]'] = params.isActive;
      return apiClient.getPage<MasterRecordView>(`/admin/${slug}`, { query, signal });
    },
  });
}

/** `POST /admin/{slug}` — create a master record (maker-checker governed server-side). */
export function useCreateMaster(
  slug: MasterSlug,
): UseMutationResult<MasterMutationResult, unknown, CreateMasterBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMasterBody) =>
      apiClient.post<MasterMutationResult>(`/admin/${slug}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: masterDataKeys.resource(slug) }),
  });
}

export interface UpdateMasterInput {
  id: string;
  body: PatchMasterBody;
}

/** `PATCH /admin/{slug}/{id}` — update (incl. deactivate via `isActive:false`). */
export function useUpdateMaster(
  slug: MasterSlug,
): UseMutationResult<MasterMutationResult, unknown, UpdateMasterInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateMasterInput) =>
      apiClient.patch<MasterMutationResult>(`/admin/${slug}/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: masterDataKeys.resource(slug) }),
  });
}
