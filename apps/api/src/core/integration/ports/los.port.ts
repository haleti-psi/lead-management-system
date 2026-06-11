import type { IntegrationPort } from './integration-port';

/**
 * LOS (Loan Origination System) provider port — eligibility, hand-off, and
 * status calls (integration-map.md §LOS). Per ADR-4 the system is BUILT against
 * the mock ({@link LosMockAdapter}); the real {@link LosHttpAdapter} is swapped
 * in last. Consumers (M11 hand-off/eligibility FRs) call this only through the
 * {@link IntegrationGateway}, never directly.
 *
 * The payload/body generics are intentionally left at the {@link IntegrationPort}
 * defaults (`unknown`): the gateway treats the body as opaque and the calling
 * module decodes it. A narrower per-call type can be supplied at the call site.
 */
export type LosPort = IntegrationPort;

/** DI token for {@link LosPort} (symbol so the adapter is swappable per env). */
export const LOS_PORT = Symbol('LOS_PORT');
