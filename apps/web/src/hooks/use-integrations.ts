import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  DeliveryStatus,
  EventCode,
  IntegrationDirection,
  IntegrationKind,
  IntegrationStatus,
} from '@lms/shared';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';

/**
 * FR-140 (M15) — integration monitor + webhook subscriptions.
 *   GET  /admin/integrations  — paginated integration_logs (filterable)
 *   GET  /admin/webhooks      — paginated webhook subscriptions
 *   POST /admin/webhooks      — create a webhook subscription
 * Gated server-side by `configuration` + scope A (ADMIN/HEAD); a scope-B holder
 * gets FORBIDDEN, surfaced as the table's error state. Mirrors the API DTOs.
 */
export interface IntegrationLog {
  integrationLogId: string;
  integration: IntegrationKind;
  direction: IntegrationDirection;
  leadId: string | null;
  correlationId: string;
  idempotencyKey: string | null;
  requestRef: string | null;
  status: IntegrationStatus;
  httpStatus: number | null;
  retryCount: number;
  errorCode: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Webhook {
  webhookSubscriptionId: string;
  eventCode: EventCode;
  targetUrl: string;
  isActive: boolean;
  lastStatus: DeliveryStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationLogFilters {
  integration?: string;
  status?: string;
  direction?: string;
  lead_id?: string;
}

export const INTEGRATION_LOG_DEFAULT_SORT = '-created_at' as const;

export interface IntegrationLogParams {
  page: number;
  limit: number;
  sort?: string;
  filters: IntegrationLogFilters;
}

export interface CreateWebhookBody {
  eventCode: string;
  targetUrl: string;
  secretRef: string;
}

export const integrationKeys = {
  logs: (params: IntegrationLogParams) => ['admin-integrations', params] as const,
  webhooks: (page: number, limit: number) => ['admin-webhooks', page, limit] as const,
};

/** `GET /admin/integrations` — integration activity log (server-paginated). */
export function useIntegrationLogs(
  params: IntegrationLogParams,
  enabled = true,
): UseQueryResult<PageResult<IntegrationLog>> {
  return useQuery({
    queryKey: integrationKeys.logs(params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = {
        page: params.page,
        limit: params.limit,
        sort: params.sort ?? INTEGRATION_LOG_DEFAULT_SORT,
      };
      if (params.filters.integration) query['filter[integration]'] = params.filters.integration;
      if (params.filters.status) query['filter[status]'] = params.filters.status;
      if (params.filters.direction) query['filter[direction]'] = params.filters.direction;
      if (params.filters.lead_id) query['filter[lead_id]'] = params.filters.lead_id;
      return apiClient.getPage<IntegrationLog>('/admin/integrations', { query, signal });
    },
  });
}

/** `GET /admin/webhooks` — webhook subscriptions (server-paginated). */
export function useWebhooks(
  page = 1,
  limit = 25,
  enabled = true,
): UseQueryResult<PageResult<Webhook>> {
  return useQuery({
    queryKey: integrationKeys.webhooks(page, limit),
    enabled,
    queryFn: ({ signal }) => apiClient.getPage<Webhook>('/admin/webhooks', { query: { page, limit }, signal }),
  });
}

export interface CreateWebhookVars {
  body: CreateWebhookBody;
  /** Stable across a user-driven retry so the server replays (IDEMPOTENT_REPLAY)
   * instead of inserting a duplicate subscription. */
  idempotencyKey: string;
}

/** `POST /admin/webhooks` — register a webhook subscription. */
export function useCreateWebhook(): UseMutationResult<Webhook, unknown, CreateWebhookVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: CreateWebhookVars) =>
      apiClient.post<Webhook>('/admin/webhooks', body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-webhooks'] }),
  });
}
