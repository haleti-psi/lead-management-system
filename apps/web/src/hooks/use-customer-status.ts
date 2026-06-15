import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface CustomerStatusData {
  lead_code: string;
  customer_name: string;
  stage_label: string;
  stage_description: string;
  pending_actions: string[];
  is_handed_off: boolean;
  los_status_label: string | null;
}

export interface CallbackBody {
  preferred_slot: string;
  note?: string;
}

export interface CallbackData {
  task_id: string;
  message: string;
}

/** FR-062 — `GET /c/{token}/status` (public). `skipAuthRefresh` so a 404 never
 * triggers the staff token-refresh → /login redirect; no retry on a dead link. */
export function useCustomerStatus(token: string): UseQueryResult<CustomerStatusData> {
  return useQuery({
    queryKey: ['customer-status', token],
    queryFn: ({ signal }) =>
      apiClient.get<CustomerStatusData>(`/c/${token}/status`, { signal, skipAuthRefresh: true }),
    enabled: Boolean(token),
    retry: false,
  });
}

/** FR-062 — `POST /c/{token}/callback`. Sends a per-submit `Idempotency-Key`. */
export function useRequestCallback(token: string): UseMutationResult<CallbackData, unknown, CallbackBody> {
  return useMutation({
    mutationFn: (body: CallbackBody) =>
      apiClient.post<CallbackData>(`/c/${token}/callback`, body, {
        skipAuthRefresh: true,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
  });
}
