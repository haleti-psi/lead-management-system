import type { IntegrationPort } from './integration-port';

/**
 * CTI (Computer Telephony Integration) provider port — disposition sync and call
 * logging (integration-map.md §CTI; OD-08; Phase 1.5).
 *
 * Phase 1.5: vendor TBD (`TelephonyHttpAdapter`). The MVP path is manual
 * disposition only; when `CTI_ENABLED=true` the gateway call fires post-commit
 * (non-blocking against the user transaction). The mock adapter is bound in every
 * environment until the real vendor lands.
 *
 * Consumers (TaskService FR-102) call this only through IntegrationGateway —
 * never directly. The gateway adds idempotency, retry, circuit-breaker, and
 * IntegrationLog recording.
 */
export type TelephonyPort = IntegrationPort;

/** DI token for TelephonyPort (symbol so the adapter is swappable per env). */
export const TELEPHONY_PORT = Symbol('TELEPHONY_PORT');
