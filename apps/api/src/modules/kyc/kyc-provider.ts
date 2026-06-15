import { randomUUID } from 'node:crypto';

import { IntegrationKind, KycException, KycType } from '@lms/shared';

/**
 * FR-071 — the KYC provider contract: what the calling module sends through the
 * {@link IntegrationGateway} and how it interprets the opaque provider body. The
 * gateway never decodes the payload or persists raw PII (integration_logs holds
 * only a masked ref); masking/tokenisation of the response is the CALLING
 * module's responsibility (kyc.port.ts doc) — done here.
 *
 * Resolutions (recorded in AMBIGUITY.md for Dev-1 write-back):
 *  - The bound `KycMockAdapter` returns a generic body, so a 200 with no explicit
 *    `outcome` is treated as a successful `valid` check (dev happy-path); the real
 *    adapters / an extended mock will return `outcome: 'mismatch'` for exceptions.
 *  - `pan_token` / `aadhaar_ref_token` are OPAQUE SURROGATES generated here (the
 *    raw value is sent to the provider but NEVER persisted). A real provider/vault
 *    returns its own token; swapping that in is the adapter's job.
 */

/** Provider-down vs business-mismatch both surface here; only mismatch reaches
 * interpretation (provider-down throws UPSTREAM_UNAVAILABLE in the gateway). */
export interface KycOutcome {
  success: boolean;
  exceptionType: KycException | null;
  provider: string;
  reference: string | null;
  maskedResponse: Record<string, unknown> | null;
  /** lead_identities enrichment (only on success, per type). */
  panToken?: string;
  panMasked?: string;
  ckycId?: string;
  aadhaarRefToken?: string;
}

/** The opaque body shape an adapter may return (all optional — see resolutions). */
interface KycProviderBody {
  outcome?: 'valid' | 'mismatch';
  exceptionType?: string;
  reference?: string;
  nameMatch?: boolean;
  ckycId?: string;
}

/** Per-type request payload sent to the provider (raw PII rides here, never persisted). */
export interface KycProviderPayload {
  kycType: KycType;
  pan?: string;
  aadhaarOfflineXml?: string;
  digilockerCode?: string;
}

const KYC_TYPE_TO_INTEGRATION: Readonly<Record<Exclude<KycType, 'manual'>, IntegrationKind>> = {
  [KycType.PAN]: IntegrationKind.PAN,
  [KycType.CKYC]: IntegrationKind.CKYC,
  [KycType.DIGILOCKER]: IntegrationKind.DIGILOCKER,
  [KycType.AADHAAR_OTP]: IntegrationKind.AADHAAR,
  [KycType.VCIP]: IntegrationKind.VCIP,
};

/** Map a (non-manual) KYC type to its `integration_kind` (drives the breaker key). */
export function kycTypeToIntegrationKind(kycType: Exclude<KycType, 'manual'>): IntegrationKind {
  return KYC_TYPE_TO_INTEGRATION[kycType];
}

/** Mask a PAN `ABCDE1234F` → `ABCDE****F` (LLD §masked storage; TC-016). */
export function maskPan(pan: string): string {
  return `${pan.slice(0, 5)}****${pan.slice(-1)}`;
}

/** Default provider label per type when the body carries none (mock has no vendor). */
const PROVIDER_LABEL: Readonly<Record<KycType, string>> = {
  [KycType.PAN]: 'pan_provider',
  [KycType.CKYC]: 'ckyc_registry',
  [KycType.DIGILOCKER]: 'digilocker',
  [KycType.AADHAAR_OTP]: 'aadhaar_offline',
  [KycType.VCIP]: 'vcip_provider',
  [KycType.MANUAL]: 'manual',
};

/**
 * Interpret a successful (HTTP 2xx) provider response into a {@link KycOutcome}.
 * A body `outcome: 'mismatch'` → failed + exceptionType (no raw PII persisted);
 * anything else → success with the per-type masked enrichment. Provider-down is
 * handled upstream (gateway throws), never here.
 */
export function interpretProviderResponse(
  kycType: Exclude<KycType, 'manual'>,
  body: unknown,
  payload: KycProviderPayload,
): KycOutcome {
  const parsed = readBody(body);
  const provider = PROVIDER_LABEL[kycType];

  if (parsed.outcome === 'mismatch') {
    return {
      success: false,
      exceptionType: toException(parsed.exceptionType, kycType),
      provider,
      reference: parsed.reference ?? null,
      maskedResponse: { outcome: 'mismatch', exceptionType: toException(parsed.exceptionType, kycType) },
    };
  }

  switch (kycType) {
    case KycType.PAN: {
      const panMasked = payload.pan ? maskPan(payload.pan) : undefined;
      return {
        success: true,
        exceptionType: null,
        provider,
        reference: parsed.reference ?? null,
        maskedResponse: { panStatus: 'valid', nameMatch: parsed.nameMatch ?? true, maskedPan: panMasked ?? null },
        panToken: opaqueToken('pan'),
        panMasked,
      };
    }
    case KycType.CKYC:
      return {
        success: true,
        exceptionType: null,
        provider,
        reference: parsed.reference ?? null,
        maskedResponse: { ckycFound: true },
        ckycId: parsed.ckycId ?? `CKYC${randomDigits()}`,
      };
    case KycType.AADHAAR_OTP:
      return {
        success: true,
        exceptionType: null,
        provider,
        reference: parsed.reference ?? null,
        maskedResponse: { aadhaarVerified: true },
        // OPAQUE surrogate — never the raw 12-digit number (INV-1/INV-2).
        aadhaarRefToken: opaqueToken('aadhaar'),
      };
    case KycType.DIGILOCKER:
      return {
        success: true,
        exceptionType: null,
        provider,
        reference: parsed.reference ?? null,
        maskedResponse: { docType: 'aadhaar', source: 'digilocker' },
      };
    case KycType.VCIP:
      return {
        success: true,
        exceptionType: null,
        provider,
        reference: parsed.reference ?? null,
        maskedResponse: { livenessResult: 'pass' },
      };
  }
}

/** Manual KYC — no provider call (LLD §KycPort: manual records success directly). */
export function manualOutcome(): KycOutcome {
  return {
    success: true,
    exceptionType: null,
    provider: PROVIDER_LABEL[KycType.MANUAL],
    reference: null,
    maskedResponse: { manual: true },
  };
}

function readBody(body: unknown): KycProviderBody {
  if (typeof body !== 'object' || body === null) return {};
  const b = body as Record<string, unknown>;
  return {
    outcome: b.outcome === 'mismatch' ? 'mismatch' : b.outcome === 'valid' ? 'valid' : undefined,
    exceptionType: typeof b.exceptionType === 'string' ? b.exceptionType : undefined,
    reference: typeof b.reference === 'string' ? b.reference : undefined,
    nameMatch: typeof b.nameMatch === 'boolean' ? b.nameMatch : undefined,
    ckycId: typeof b.ckycId === 'string' ? b.ckycId : undefined,
  };
}

/** Coerce a provider exception string to the `kyc_exception` enum; default by type. */
function toException(value: string | undefined, kycType: KycType): KycException {
  const known = (Object.values(KycException) as string[]).includes(value ?? '');
  if (known) return value as KycException;
  return kycType === KycType.PAN ? KycException.PAN_MISMATCH : KycException.NAME_MISMATCH;
}

/** Opaque, non-reversible surrogate token (≤64 chars) — carries no PII. */
function opaqueToken(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function randomDigits(): string {
  return randomUUID().replace(/\D/g, '').slice(0, 10);
}
