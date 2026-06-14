/**
 * FR-113 — React Query hooks for DLA/LSP registry CRUD.
 * All API calls use the foundation `apiClient` (typed fetch with envelope).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type {
  CreateDlaInput,
  DlaItem,
  DlaListResult,
  DlaType,
  ConfigStatus,
  UpdateDlaInput,
} from './dla-registry.types';

export interface ListDlaParams {
  page?: number;
  limit?: number;
  type?: DlaType;
  status?: ConfigStatus;
  sort?: string;
}

/** Query key factory for DLA registry entries. */
export const dlaRegistryKeys = {
  list: (params: ListDlaParams) => ['dla-registry', 'list', params] as const,
};

/** Fetch paginated DLA/LSP registry (`GET /compliance/dla`). */
export function useDlaRegistry(params: ListDlaParams = {}) {
  return useQuery({
    queryKey: dlaRegistryKeys.list(params),
    queryFn: () =>
      apiClient.get<DlaListResult>('/compliance/dla', {
        query: params as Record<string, string | number | boolean | undefined | null>,
      }),
  });
}

/** Create a new DLA/LSP registry entry (`POST /compliance/dla`). */
export function useCreateDla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDlaInput) =>
      apiClient.post<DlaItem>('/compliance/dla', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dla-registry', 'list'] });
    },
  });
}

/** Update an existing DLA/LSP registry entry (`PATCH /compliance/dla`). */
export function useUpdateDla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDlaInput) =>
      apiClient.patch<DlaItem>('/compliance/dla', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dla-registry'] });
    },
  });
}
