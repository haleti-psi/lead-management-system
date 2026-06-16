import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult } from '@/lib/api';
import type { RoleView, UpdateRoleBody } from '@/types/admin';

export interface RoleListParams {
  page: number;
  limit: number;
}

export const adminRoleKeys = {
  all: ['admin', 'roles'] as const,
  list: (params: RoleListParams) => ['admin', 'roles', params] as const,
};

/** FR-130 §4 — list roles with their permission sets (`GET /admin/roles`). */
export function useAdminRoles(
  params: RoleListParams,
  enabled = true,
): UseQueryResult<PageResult<RoleView>> {
  return useQuery({
    queryKey: adminRoleKeys.list(params),
    enabled,
    queryFn: ({ signal }) =>
      apiClient.getPage<RoleView>('/admin/roles', {
        query: { page: params.page, limit: params.limit },
        signal,
      }),
  });
}

export interface UpdateRoleInput {
  roleId: string;
  body: UpdateRoleBody;
}

/** FR-130 §5 — update a role's name/scope and/or replace its permission set
 * (`PATCH /admin/roles/{id}`). */
export function useUpdateRole(): UseMutationResult<RoleView, unknown, UpdateRoleInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, body }: UpdateRoleInput) =>
      apiClient.patch<RoleView>(`/admin/roles/${roleId}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminRoleKeys.all }),
  });
}
