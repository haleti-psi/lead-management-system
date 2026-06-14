/**
 * FR-111 — React Query hook for the DPO data-sharing log view.
 * Calls `GET /api/v1/leads/{id}/sharing-logs` and returns the paginated result.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

/** One row from `data_sharing_logs` as returned by the API. */
export interface SharingLogItem {
  dataShareLogId: string;
  leadId: string;
  recipient: string;
  purpose: string;
  dataCategory: string;
  consentId: string | null;
  status: string;
  sharedAt: string;
  createdAt: string;
}

/** API envelope shape returned by `GET /leads/{id}/sharing-logs`. */
export interface SharingLogsResult {
  data: SharingLogItem[];
  meta: {
    correlation_id: string;
    pagination: { page: number; limit: number; total: number };
  };
  error: null;
}

export interface SharingLogsParams {
  leadId: string;
  page?: number;
  limit?: number;
}

/** Query key factory for sharing logs. */
export const sharingLogKeys = {
  list: (params: SharingLogsParams) => ['sharing-logs', 'list', params] as const,
};

/**
 * Fetch paginated data-sharing log rows for a lead (FR-111 DPO view).
 */
export function useSharingLogs(params: SharingLogsParams) {
  const { leadId, page = 1, limit = 25 } = params;
  return useQuery({
    queryKey: sharingLogKeys.list(params),
    queryFn: () =>
      apiClient.get<SharingLogsResult>(`/leads/${leadId}/sharing-logs`, {
        query: { page, limit },
      }),
    enabled: Boolean(leadId),
  });
}
