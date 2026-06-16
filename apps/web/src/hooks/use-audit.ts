import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { isApiClientError } from '@/lib/api';
import { fetchAuditPage, unmaskAuditField, type AuditPageParams } from '@/lib/api/audit';
import type { AuditFilters, AuditPageResult, AuditUnmaskRequest, AuditUnmaskResult } from '@/types/audit';

/**
 * FR-123 — TanStack Query hooks for the audit explorer (M13).
 *
 * `useAudit` reads `GET /api/v1/audit` keyed by `['audit', filters, page, limit]`.
 * Compliance data must always be fresh, so `staleTime: 0`; `placeholderData`
 * keeps the previous page visible during pagination so rows do not flash. 4xx
 * (validation/forbidden/not-found) are never retried — the user must change the
 * query — while transient failures get a single retry.
 *
 * `useUnmaskAudit` posts `POST /api/v1/audit/unmask` (one field, one row, with a
 * reason). It is intentionally NOT cached and does not invalidate the list: the
 * reveal is transient and the list always stays masked.
 */

export const auditKeys = {
  all: ['audit'] as const,
  page: (filters: AuditFilters, page: number, limit: number) =>
    ['audit', filters, page, limit] as const,
};

export interface UseAuditParams extends AuditPageParams {
  filters: AuditFilters;
  /** Gate the fetch; the explorer page passes the `audit_trail` capability so a
   * user without it never triggers a request (the server also enforces 403). */
  enabled?: boolean;
}

export function useAudit(params: UseAuditParams): UseQueryResult<AuditPageResult> {
  const { filters, page, limit, enabled = true } = params;
  return useQuery({
    queryKey: auditKeys.page(filters, page, limit),
    queryFn: ({ signal }) => fetchAuditPage(filters, { page, limit }, signal),
    enabled,
    staleTime: 0,
    placeholderData: (prev) => prev,
    retry: (failureCount, error) => {
      if (isApiClientError(error) && [400, 403, 404].includes(error.status)) return false;
      return failureCount < 1;
    },
  });
}

export function useUnmaskAudit(): UseMutationResult<AuditUnmaskResult, unknown, AuditUnmaskRequest> {
  return useMutation({
    mutationFn: (body: AuditUnmaskRequest) => unmaskAuditField(body),
  });
}
