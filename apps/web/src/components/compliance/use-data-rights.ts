/**
 * FR-112 — React Query hooks for data-rights CRUD.
 * All API calls use the foundation `apiClient` (typed fetch with envelope).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type {
  CreateDataRightsInput,
  DataRightsItem,
  DataRightsListResult,
  UpdateDataRightsInput,
} from './data-rights.types';

export interface ListDataRightsParams {
  page?: number;
  limit?: number;
  status?: string;
  request_type?: string;
  customer_profile_id?: string;
  due_before?: string;
}

/** Query key factory for data-rights requests. */
export const dataRightsKeys = {
  list: (params: ListDataRightsParams) => ['data-rights', 'list', params] as const,
  detail: (id: string) => ['data-rights', 'detail', id] as const,
};

/** Fetch paginated data-rights list (`GET /data-rights`). */
export function useDataRights(params: ListDataRightsParams = {}) {
  return useQuery({
    queryKey: dataRightsKeys.list(params),
    queryFn: () =>
      apiClient.get<DataRightsListResult>('/data-rights', {
        query: params as Record<string, string | number | boolean | undefined | null>,
      }),
  });
}

/** Create a new data-rights request (`POST /data-rights`). */
export function useCreateDataRights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDataRightsInput) =>
      apiClient.post<DataRightsItem>('/data-rights', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['data-rights', 'list'] });
    },
  });
}

/** Process a data-rights request (`PATCH /data-rights/{id}`). DPO only. */
export function useProcessDataRights(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDataRightsInput) =>
      apiClient.patch<DataRightsItem>(`/data-rights/${requestId}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['data-rights'] });
    },
  });
}
