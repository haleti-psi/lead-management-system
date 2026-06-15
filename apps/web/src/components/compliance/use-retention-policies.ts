/**
 * FR-115 — React Query hooks for retention policy CRUD.
 * All API calls use the foundation `apiClient` (typed fetch with envelope).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type {
  CreateRetentionPolicyInput,
  ListRetentionPoliciesParams,
  RetentionPolicy,
  RetentionPolicyListResult,
} from './retention.types';

/** Query key factory for retention policies. */
export const retentionPoliciesKeys = {
  list: (params: ListRetentionPoliciesParams) => ['retention-policies', 'list', params] as const,
};

/** Fetch paginated retention policies (`GET /admin/retention-policies`). */
export function useRetentionPolicies(params: ListRetentionPoliciesParams = {}) {
  return useQuery({
    queryKey: retentionPoliciesKeys.list(params),
    queryFn: () =>
      apiClient.get<RetentionPolicyListResult>('/admin/retention-policies', {
        query: params as Record<string, string | number | boolean | undefined | null>,
      }),
  });
}

/** Create a retention policy (`POST /admin/retention-policies`). */
export function useCreateRetentionPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRetentionPolicyInput) =>
      apiClient.post<{ data: RetentionPolicy }>('/admin/retention-policies', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['retention-policies', 'list'] });
    },
  });
}
