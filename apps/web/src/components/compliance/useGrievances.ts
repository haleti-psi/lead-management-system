/**
 * FR-114 — React Query hooks for grievance CRUD.
 * All API calls use the foundation `apiClient` (typed fetch with envelope).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type {
  CreateGrievanceInput,
  GrievanceItem,
  GrievanceListResult,
  UpdateGrievanceInput,
} from './grievance.types';

export interface ListGrievancesParams {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
  owner_id?: string;
  lead_id?: string;
  from?: string;
  to?: string;
  sort?: string;
}

/** Query key factory for grievances. */
export const grievanceKeys = {
  list: (params: ListGrievancesParams) => ['grievances', 'list', params] as const,
  detail: (id: string) => ['grievances', 'detail', id] as const,
};

/** Fetch paginated grievances list (`GET /grievances`). */
export function useGrievances(params: ListGrievancesParams = {}) {
  return useQuery({
    queryKey: grievanceKeys.list(params),
    queryFn: () =>
      apiClient.get<GrievanceListResult>('/grievances', {
        query: params as Record<string, string | number | boolean | undefined | null>,
      }),
  });
}

/** Create a new grievance (`POST /grievances`). */
export function useCreateGrievance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGrievanceInput) =>
      apiClient.post<GrievanceItem>('/grievances', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grievances', 'list'] });
    },
  });
}

/** Update / resolve / close a grievance (`PATCH /grievances/{id}`). */
export function useUpdateGrievance(grievanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGrievanceInput) =>
      apiClient.patch<GrievanceItem>(`/grievances/${grievanceId}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grievances'] });
    },
  });
}
