import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, isApiClientError } from '@/lib/api';
import type { CommChannel, ConsentPurpose } from '../../../features/admin/templates/use-templates';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed';

export interface CommLogDto {
  communication_log_id: string;
  lead_id: string;
  template_id: string | null;
  channel: CommChannel;
  recipient: string;
  consent_basis: ConsentPurpose | null;
  status: DeliveryStatus;
  provider_ref: string | null;
  failure_reason: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommLogListResult {
  data: CommLogDto[];
  meta: { page: number; limit: number; total: number; correlation_id?: string };
}

export interface SendCommResult {
  communication_log_id: string;
  status: 'queued';
}

export interface SendCommunicationInput {
  template_id: string;
  channel: CommChannel;
  consent_basis: ConsentPurpose;
  recipient: string;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const commKeys = {
  all: (leadId: string) => ['leads', leadId, 'communications'] as const,
  list: (leadId: string) => ['leads', leadId, 'communications', 'list'] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * FR-101 — List communication logs for a lead (paginated, recipient masked).
 * Backend: GET /leads/{id}/communications — requires customer_comm capability.
 */
export function useCommunicationLogs(leadId: string): {
  data: CommLogListResult | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const query = useQuery({
    queryKey: commKeys.list(leadId),
    queryFn: () =>
      apiClient.get<CommLogListResult>(`/leads/${leadId}/communications`, {
        query: { page: 1, limit: 25 },
      }),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (isApiClientError(error) && (error.status === 403 || error.status === 401)) return false;
      return failureCount < 2;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * FR-101 — Send a templated communication to a lead (consent-gated, returns 202).
 */
export function useSendCommunication(leadId: string): {
  mutate: (input: SendCommunicationInput) => void;
  mutateAsync: (input: SendCommunicationInput) => Promise<SendCommResult>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SendCommunicationInput) =>
      apiClient.post<SendCommResult>(`/leads/${leadId}/communications`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commKeys.all(leadId) });
    },
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset,
  };
}
