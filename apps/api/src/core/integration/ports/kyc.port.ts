import type { IntegrationPort } from './integration-port';

/**
 * KYC provider port — PAN / CKYC / DigiLocker / Aadhaar / V-CIP
 * (integration-map.md §KYC). PAN is MVP-Must; the rest are MVP-Should / Phase
 * 1.5 and share this port behind per-type adapters. FR-140 provides the port and
 * a mock ({@link KycMockAdapter}); never call a real KYC provider in tests
 * (integration-map.md §KYC test double).
 *
 * Sensitive responses (Aadhaar/biometrics) must be masked by the CALLING module
 * before persistence (`kyc_verifications.masked_response`); the gateway only
 * sees the opaque {@link ProviderResponse} body and persists no raw payload.
 */
export type KycPort = IntegrationPort;

/** DI token for {@link KycPort}. */
export const KYC_PORT = Symbol('KYC_PORT');
