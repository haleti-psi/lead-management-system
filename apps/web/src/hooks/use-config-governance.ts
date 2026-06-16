import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type {
  ApproveConfigBody,
  ApproveConfigResult,
  RollbackConfigBody,
  RollbackConfigResult,
} from '@/types/config-governance';

/**
 * FR-132 — Configuration Governance (maker-checker) data hooks.
 *
 * The backend (`ConfigGovernanceController`) exposes ONLY two actions, each
 * keyed by a `configuration_versions` id:
 *   - `POST /admin/config/{id}/approve`  (approve OR reject, via the body `action`)
 *   - `POST /admin/config/{id}/rollback`
 * There is no list or GET-by-id endpoint for pending versions, so these are
 * mutations only — there is no query to invalidate. The caller drives state
 * (e.g. clearing the form / showing the result) from the resolved value.
 *
 * Every call goes through `apiClient`, so a non-2xx envelope rejects with
 * `ApiClientError` carrying the taxonomy `code` (FORBIDDEN / CONFLICT /
 * NOT_FOUND / VALIDATION_ERROR) the UI branches on.
 */

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
