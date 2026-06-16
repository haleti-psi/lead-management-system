import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type {
  ApproveConfigBody,
  ApproveConfigResult,
  PendingConfigVersion,
  RollbackConfigBody,
  RollbackConfigResult,
} from '@/types/config-governance';

/**
 * FR-132 — Configuration Governance (maker-checker) data hooks over the
 * `ConfigGovernanceController` endpoints:
 *   - `GET  /admin/config`              — paginated queue of `pending` versions
 *   - `POST /admin/config/{id}/approve` — approve OR reject, via the body `action`
 *   - `POST /admin/config/{id}/rollback`
 *
 * The list read uses `getPage` so the DataTable receives `meta.pagination`; the
 * page invalidates {@link configGovernanceKeys} after an action so the queue
 * reflects the new state. Every call goes through `apiClient`, so a non-2xx
 * envelope rejects with `ApiClientError` carrying the taxonomy `code`
 * (FORBIDDEN / CONFLICT / NOT_FOUND / VALIDATION_ERROR) the UI branches on.
 */

/** React Query cache keys for the pending-config queue. */
export const configGovernanceKeys = {
  all: ['admin-config'] as const,
  list: (params: ConfigVersionsParams) => ['admin-config', params] as const,
};

/** Query params for {@link useConfigVersions} (mirrors `ListConfigVersionsQuery`). */
export interface ConfigVersionsParams {
  page: number;
  limit: number;
  /** When set, narrows the queue to one `config_type`. */
  configType?: string;
}

/** `GET /admin/config` — server-paginated queue of `pending` configuration versions. */
export function useConfigVersions(
  params: ConfigVersionsParams,
  enabled = true,
): UseQueryResult<PageResult<PendingConfigVersion>> {
  return useQuery({
    queryKey: configGovernanceKeys.list(params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit };
      if (params.configType !== undefined) query.config_type = params.configType;
      return apiClient.getPage<PendingConfigVersion>('/admin/config', { query, signal });
    },
  });
}

/** Input to {@link useApproveConfig}: the version id + the decision body. */
export interface ApproveConfigInput {
  versionId: string;
  body: ApproveConfigBody;
}

/** `POST /admin/config/{id}/approve` — approve or reject a pending version. */
export function useApproveConfig(): UseMutationResult<ApproveConfigResult, unknown, ApproveConfigInput> {
  return useMutation({
    mutationFn: ({ versionId, body }: ApproveConfigInput) =>
      apiClient.post<ApproveConfigResult>(`/admin/config/${versionId}/approve`, body),
  });
}

/** Input to {@link useRollbackConfig}: the active version id + the reason body. */
export interface RollbackConfigInput {
  versionId: string;
  body: RollbackConfigBody;
}

/** `POST /admin/config/{id}/rollback` — roll back an active version. */
export function useRollbackConfig(): UseMutationResult<RollbackConfigResult, unknown, RollbackConfigInput> {
  return useMutation({
    mutationFn: ({ versionId, body }: RollbackConfigInput) =>
      apiClient.post<RollbackConfigResult>(`/admin/config/${versionId}/rollback`, body),
  });
}
