import { ConsentPurpose, ConsentState, ConsentStatus } from '@lms/shared';

/**
 * FR-110 — canonical consent-status derivation (M12 owns this; FR-110 LLD
 * §Transaction boundary). Pure module: no Nest/DB dependencies so both M12
 * (ledger re-derivation) and M2 capture (intake derivation, FR-010) import the
 * SAME constant + algorithm — one source of truth, the two derivations can
 * never diverge.
 */

/**
 * Purposes whose latest state must all be `granted` for the derived
 * `leads.consent_status` to be `captured` (FR-110 LLD: "configurable but
 * default to" this set; confirm via ProductConfig/BRD addendum before
 * production — FR-110 §Ambiguities 1).
 */
export const REQUIRED_CONSENT_PURPOSES: readonly ConsentPurpose[] = [
  ConsentPurpose.LEAD_CONTACT,
  ConsentPurpose.PRODUCT_ELIGIBILITY,
  ConsentPurpose.KYC,
  ConsentPurpose.DOCUMENT_PROCESSING,
  ConsentPurpose.LOS_HANDOFF,
];

/** The (purpose, state) pair the derivation inspects — one entry per purpose. */
export interface ConsentStateEntry {
  readonly purpose: ConsentPurpose;
  readonly state: ConsentState;
}

/**
 * Derive `leads.consent_status` from the latest non-superseded consent state
 * per purpose (FR-110 LLD §Transaction boundary, exact rules):
 *
 *   any purpose `withdrawn`            → `withdrawn`
 *   all REQUIRED purposes `granted`    → `captured`
 *   any purpose `granted`              → `partial`
 *   otherwise                          → `pending`
 *
 * Callers supply the reduced latest-per-purpose set (M12 reads it from the
 * ledger; FR-010 passes the intake `consents[]`).
 */
export function deriveConsentStatus(
  latestPerPurpose: readonly ConsentStateEntry[],
): ConsentStatus {
  if (latestPerPurpose.some((entry) => entry.state === ConsentState.WITHDRAWN)) {
    return ConsentStatus.WITHDRAWN;
  }
  const granted = new Set(
    latestPerPurpose
      .filter((entry) => entry.state === ConsentState.GRANTED)
      .map((entry) => entry.purpose),
  );
  if (REQUIRED_CONSENT_PURPOSES.every((purpose) => granted.has(purpose))) {
    return ConsentStatus.CAPTURED;
  }
  if (granted.size > 0) {
    return ConsentStatus.PARTIAL;
  }
  return ConsentStatus.PENDING;
}
