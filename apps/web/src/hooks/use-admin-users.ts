import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type { CreateUserBody, UpdateUserBody, UserView } from '@/types/admin';

/** FR-130 — `GET /admin/users` query parameters (server-paginated). */
export interface UserListParams {
  page: number;
  limit: number;
  /** `+`/`-` prefixed allow-listed column (created_at | full_name | username). */
  sort: string;
  status?: string;
  roleId?: string;
  branchId?: string;
  teamId?: string;
}

export const adminUserKeys = {
  all: ['admin', 'users'] as const,
  list: (params: UserListParams) => ['admin', 'users', params] as const,
};

/** FR-130 §1 — list users (masked email/mobile). Filters are sent as the
 * server's nested `filter[…]` keys; `getPage` preserves `meta.pagination`. */
export function useAdminUsers(
  params: UserListParams,
  enabled = true,
): UseQueryResult<PageResult<UserView>> {
  return useQuery({
    queryKey: adminUserKeys.list(params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit, sort: params.sort };
      if (params.status) query['filter[status]'] = params.status;
      if (params.roleId) query['filter[role_id]'] = params.roleId;
      if (params.branchId) query['filter[branch_id]'] = params.branchId;
      if (params.teamId) query['filter[team_id]'] = params.teamId;
      return apiClient.getPage<UserView>('/admin/users', { query, signal });
    },
  });
}

/** FR-130 §2 — create a user (`POST /admin/users`). */
export function useCreateUser(): UseMutationResult<UserView, unknown, CreateUserBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserBody) => apiClient.post<UserView>('/admin/users', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminUserKeys.all }),
  });
}

export interface UpdateUserInput {
  userId: string;
  body: UpdateUserBody;
}

/** FR-130 §3 — update / deactivate / reactivate / unlock a user
 * (`PATCH /admin/users/{id}`). Status transitions and field edits share this. */
export function useUpdateUser(): UseMutationResult<UserView, unknown, UpdateUserInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: UpdateUserInput) =>
      apiClient.patch<UserView>(`/admin/users/${userId}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminUserKeys.all }),
  });
}
