/**
 * FR-141 transactional-outbox runtime constants.
 *
 * Per the LLD (Assumption 2) these are fixed runtime constants, NOT environment
 * variables — the BRD states no requirement to make them configurable. The only
 * outbox-related env var is `PUBSUB_TOPIC_EVENTS` (environment-contract.md),
 * read via AppConfigService.
 */

/** Max SELECT batch the publisher pulls per poll — also the NFR LIMIT guard. */
export const PUBLISHER_BATCH_SIZE = 100;

/**
 * Max publish attempts for a single row before it is marked `failed`. Attempts
 * are counted in-memory per process (Assumption 4): a restart resets the count,
 * giving a pending row further attempts — acceptable under at-least-once.
 */
export const MAX_PUBLISH_RETRIES = 5;

/** Default publisher poll interval (ms). The BRD leaves this open; 5s is sane. */
export const PUBLISHER_POLL_INTERVAL_MS = 5_000;

/**
 * Single-tenant MVP org id (schema.sql `event_outbox.org_id` default). The
 * column also defaults to this at the DB, but we set it explicitly so the
 * written row is self-describing and INV-08 holds regardless of DB defaults.
 */
export const ORG_ID_DEFAULT = '00000000-0000-0000-0000-000000000001';

/** Payload schema version written by `emit` when the caller does not pin one. */
export const DEFAULT_SCHEMA_VERSION = 1;
