import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { GrantStatus } from '@lms/shared';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type {
  BreakGlassGrantListItem,
  BreakGlassRequestBody,
  BreakGlassTransitionResult,
} from '@/types/break-glass';

/**
 * FR-003 — TanStack Query hooks for the break-glass endpoints
 * (`/admin/break-glass`). One server-paginated list query plus the
 * request / approve / revoke mutations; every mutation invalidates the list so
 * the table reflects the new grant state. The uniform envelope, auth cookie, and
 * single-flight refresh are handled by {@link apiClient}; the AbacGuard
 * (ADMIN/DPO, capability `break_glass`) remains authoritative server-side.
 */

const BREAK_GLASS_PATH = '/admin/break-glass';

/** `GET /admin/break-glass` query parameters (server-paginated; optional status). */
export interface BreakGlassListParams {
  page: number;
  limit: number;
  status?: GrantStatus;
}

export const breakGlassKeys = {
  all: ['break-glass'] as const,
  list: (params: BreakGlassListParams) => ['break-glass', 'list', params] as const,
};

/** List the org's grants (newest-first, paginated). `getPage` preserves
 * `meta.pagination` for the DataTable footer. */
export function useBreakGlassGrants(
  params: BreakGlassListParams,
  enabled = true,
): UseQueryResult<PageResult<BreakGlassGrantListItem>> {
  return useQuery({
    queryKey: breakGlassKeys.list(params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit };
      if (params.status) query.status = params.status;
      return apiClient.getPage<BreakGlassGrantListItem>(BREAK_GLASS_PATH, { query, signal });
    },
  });
}

/** `POST /admin/break-glass` — request a new grant (created in `pending`). */
export function useRequestBreakGlass(): UseMutationResult<
  BreakGlassTransitionResult,
  unknown,
  BreakGlassRequestBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BreakGlassRequestBody) =>
      apiClient.post<BreakGlassTransitionResult>(BREAK_GLASS_PATH, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: breakGlassKeys.all }),
  });
}

/** `POST /admin/break-glass/{id}/approve` — four-eyes approval (server enforces
 * approver ≠ grantee and that the caller is the nominated approver). */
export function useApproveBreakGlass(): UseMutationResult<
  BreakGlassTransitionResult,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      apiClient.post<BreakGlassTransitionResult>(`${BREAK_GLASS_PATH}/${grantId}/approve`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: breakGlassKeys.all }),
  });
}

/** `POST /admin/break-glass/{id}/revoke` — early revocation of a pending/active grant. */
export function useRevokeBreakGlass(): UseMutationResult<
  BreakGlassTransitionResult,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      apiClient.post<BreakGlassTransitionResult>(`${BREAK_GLASS_PATH}/${grantId}/revoke`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: breakGlassKeys.all }),
  });
}
