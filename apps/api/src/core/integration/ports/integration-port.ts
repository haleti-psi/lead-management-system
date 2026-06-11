import type { IntegrationKind } from '@lms/shared';

import type { ProviderResponse } from './provider-response';

/**
 * The neutral request envelope every gateway call carries (FR-140 LLD §Data
 * Operations — IntegrationLogRepository.createLog). It holds only what the
 * gateway needs to write the `integration_logs` lifecycle row and route the
 * call; the provider-specific payload rides in `payload` (opaque to the gateway,
 * decoded only by the concrete adapter).
 *
 * `maskedRequestRef` is a GCS path or a short masked summary (e.g.
 * `gcs://…/los/handoff/ref`) — NEVER a raw request body or PII. `request_ref`
 * is the only request artefact persisted, by design (LLD §Not applicable —
 * masking: integration_logs holds no PII).
 */
export interface IntegrationRequest<TPayload = unknown> {
  /** Which external integration this call targets (drives the breaker key). */
  integration: IntegrationKind;
  /** The lead this call relates to, when applicable (nullable FK). */
  leadId?: string | null;
  /** GCS path / masked summary persisted to `integration_logs.request_ref`. */
  maskedRequestRef?: string | null;
  /**
   * Correlation id propagated from the inbound request (CorrelationMiddleware),
   * persisted to `integration_logs.correlation_id` (NOT NULL). The calling module
   * passes the value it already holds on its request context; when omitted the
   * gateway records a synthetic system correlation id (Cloud Tasks retries).
   */
  correlationId?: string;
  /** Provider-specific payload, opaque to the gateway. */
  payload: TPayload;
}

/**
 * A hexagonal provider port (architecture §2 / integration-map.md). Concrete
 * adapters (`LosMockAdapter`, `KycMockAdapter`, the HTTP adapters) implement
 * `call`; the {@link IntegrationGateway} is the ONLY caller, so all resilience
 * (idempotency, retry, circuit breaker, logging) lives in one place and never
 * in an adapter.
 *
 * Contract: return a {@link ProviderResponse} for any provider HTTP outcome
 * (including 4xx/5xx); throw `ProviderCallError` only for a transport fault.
 */
export interface IntegrationPort<TPayload = unknown, TBody = unknown> {
  call(request: IntegrationRequest<TPayload>): Promise<ProviderResponse<TBody>>;
}
