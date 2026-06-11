/**
 * FR-141 — the publish boundary for the outbox relay.
 *
 * The {@link OutboxPublisherService} depends only on this port, never on the
 * Pub/Sub SDK directly, so unit/integration tests inject a Jest mock (per
 * integration-map.md: "Test → Jest mocks of each port; never real providers")
 * and real Pub/Sub publishing is gated behind config. Pub/Sub is infrastructure
 * plumbing here — it is deliberately NOT routed through `IntegrationGateway`
 * (FR-140), which is for business integrations that write `integration_logs`.
 */
export interface EventPublisherPort {
  /**
   * Publish one domain event to the events topic. Resolves on broker ack;
   * rejects on timeout / transport / 5xx so the publisher can retry or, once
   * attempts are exhausted, mark the row `failed`. `eventId` is forwarded as the
   * deduplication key so at-least-once redelivery is idempotent downstream.
   */
  publish(message: OutboxMessage): Promise<void>;
}

/** The wire shape relayed to the events topic (FR-141 LLD Path B step 3). */
export interface OutboxMessage {
  readonly eventId: string;
  readonly data: OutboxMessageData;
  readonly attributes: OutboxMessageAttributes;
}

/** JSON body of the published message. */
export interface OutboxMessageData {
  readonly event_id: string;
  readonly event_code: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly schema_version: number;
  readonly payload: unknown;
  readonly org_id: string;
  readonly created_at: string;
}

/** Pub/Sub message attributes (string-valued, for subscriber filtering). */
export interface OutboxMessageAttributes {
  readonly event_code: string;
  readonly aggregate_type: string;
  readonly schema_version: string;
}

/** DI token for the {@link EventPublisherPort} implementation. */
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
