/**
 * FR-141 — domain-event payload schemas, version 1.
 *
 * The reference contract for analytics / AI-readiness consumers of
 * `PUBSUB_TOPIC_EVENTS`. Per the LLD §Validation Logic ("Payload
 * schema-versioning policy"), when a payload shape changes (a field is added,
 * renamed, or removed) `schema_version` is incremented and a new `schemas/vN/`
 * is added; consumers must handle every version they subscribe to. v1 is the
 * MVP baseline.
 *
 * These are documentation/contract types only — the publisher relays whatever
 * (already-masked) payload `OutboxService.emit` stored; it does not re-validate
 * against these shapes at runtime.
 */
import type { EventCode } from '@lms/shared';

/** The schema version these types describe. */
export const OUTBOX_SCHEMA_VERSION_V1 = 1;

/**
 * The envelope published to the events topic (mirrors
 * {@link OutboxMessageData} on the wire). `payload` is event-code specific and
 * always PII-masked before it reaches the outbox.
 */
export interface OutboxEnvelopeV1<TPayload = Record<string, unknown>> {
  event_id: string;
  event_code: EventCode;
  aggregate_type: string;
  aggregate_id: string;
  schema_version: 1;
  org_id: string;
  created_at: string;
  payload: TPayload;
}
