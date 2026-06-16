import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type { CreateTeamBody, TeamView, UpdateTeamBody } from '@/types/admin';

export interface TeamListParams {
  page: number;
  limit: number;
  branchId?: string;
  /** `'true'` | `'false'` (the server coerces the string to a boolean). */
  isActive?: string;
}

export const adminTeamKeys = {
  all: ['admin', 'teams'] as const,
  list: (params: TeamListParams) => ['admin', 'teams', params] as const,
};

/** FR-130 §6 — list teams (`GET /admin/teams`), optional branch / active filter. */
export function useAdminTeams(
  params: TeamListParams,
  enabled = true,
): UseQueryResult<PageResult<TeamView>> {
  return useQuery({
    queryKey: adminTeamKeys.list(params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit };
      if (params.branchId) query['filter[branch_id]'] = params.branchId;
      if (params.isActive) query['filter[is_active]'] = params.isActive;
      return apiClient.getPage<TeamView>('/admin/teams', { query, signal });
    },
  });
}

/** FR-130 §7 — create a team (`POST /admin/teams`). */
export function useCreateTeam(): UseMutationResult<TeamView, unknown, CreateTeamBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTeamBody) => apiClient.post<TeamView>('/admin/teams', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminTeamKeys.all }),
  });
}

export interface UpdateTeamInput {
  teamId: string;
  body: UpdateTeamBody;
}

/** FR-130 §8 — update / deactivate a team (`PATCH /admin/teams/{id}`). */
export function useUpdateTeam(): UseMutationResult<TeamView, unknown, UpdateTeamInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, body }: UpdateTeamInput) =>
      apiClient.patch<TeamView>(`/admin/teams/${teamId}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminTeamKeys.all }),
  });
}
