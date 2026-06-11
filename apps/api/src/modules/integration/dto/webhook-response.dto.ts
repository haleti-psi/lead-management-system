import type { DeliveryStatus, EventCode } from '@lms/shared';

/**
 * API representation of a `webhook_subscriptions` row (LLD §Endpoints 2/3).
 * `secret_ref` is INTENTIONALLY absent — it is a Secret Manager path and must
 * never appear in any response (LLD: "`secret_ref` is never returned"). This type
 * has no `secretRef` field, so the compiler prevents accidentally leaking it.
 */
export interface WebhookResponse {
  webhookSubscriptionId: string;
  eventCode: EventCode;
  targetUrl: string;
  isActive: boolean;
  lastStatus: DeliveryStatus | null;
  createdAt: string;
  updatedAt: string;
}

/** The safe-to-return columns of a webhook row (DB snake_case), sans secret_ref. */
export interface WebhookRow {
  webhook_subscription_id: string;
  event_code: EventCode;
  target_url: string;
  is_active: boolean;
  last_status: DeliveryStatus | null;
  created_at: Date;
  updated_at: Date;
}

/** Map a DB row to the API shape (drops nothing sensitive — secret_ref was never selected). */
export function toWebhookResponse(row: WebhookRow): WebhookResponse {
  return {
    webhookSubscriptionId: row.webhook_subscription_id,
    eventCode: row.event_code,
    targetUrl: row.target_url,
    isActive: row.is_active,
    lastStatus: row.last_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
