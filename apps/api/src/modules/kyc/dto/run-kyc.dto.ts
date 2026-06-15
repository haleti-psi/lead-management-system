import { z } from 'zod';

import { KycType } from '@lms/shared';

/**
 * FR-071 — `POST /leads/{id}/kyc/{type}` request validation (LLD §Validation
 * Logic). `type` is a path param validated against the `kyc_type` enum; the body
 * shape then depends on the type. Errors map to `VALIDATION_ERROR` (400) with a
 * `fields[]` entry naming the offending field.
 */

/** Path param `type` → `kyc_type` enum. */
export const KycTypeParam = z.nativeEnum(KycType, {
  errorMap: () => ({ message: 'Must be one of: pan, ckyc, digilocker, aadhaar_otp, vcip, manual' }),
});

// Optional: the server authoritatively resolves the active granted `kyc` consent
// for the lead (gate + data_sharing_logs); the body value, when present, must be
// a UUID. See AMBIGUITY FR-071-9 (decouples the UI from a consent-id lookup).
const consentId = z.string().uuid('consentId must be a valid UUID').optional();
const idempotencyKey = z.string().max(120, 'idempotencyKey must be ≤ 120 characters').optional();

const PanBody = z.object({
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'PAN format invalid (AAAAA9999A)'),
  consentId,
  idempotencyKey,
});

const AadhaarBody = z.object({
  aadhaarOfflineXml: z.string().min(1, 'Aadhaar offline XML required (Base64)'),
  consentId,
  idempotencyKey,
});

const DigilockerBody = z.object({
  digilockerCode: z.string().min(1, 'DigiLocker OAuth code required'),
  consentId,
  idempotencyKey,
});

/** ckyc / vcip / manual carry only consent + optional idempotency. */
const ConsentOnlyBody = z.object({ consentId, idempotencyKey });

const BODY_SCHEMA = {
  [KycType.PAN]: PanBody,
  [KycType.AADHAAR_OTP]: AadhaarBody,
  [KycType.DIGILOCKER]: DigilockerBody,
  [KycType.CKYC]: ConsentOnlyBody,
  [KycType.VCIP]: ConsentOnlyBody,
  [KycType.MANUAL]: ConsentOnlyBody,
} as const;

export type RunKycBody = {
  pan?: string;
  aadhaarOfflineXml?: string;
  digilockerCode?: string;
  consentId?: string;
  idempotencyKey?: string;
};

/** Return the Zod schema for a given KYC type (controller selects by path param). */
export function bodySchemaFor(kycType: KycType): z.ZodType<RunKycBody> {
  return BODY_SCHEMA[kycType] as unknown as z.ZodType<RunKycBody>;
}
