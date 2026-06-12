import { ConsentPurpose } from '@lms/shared';

/** ABAC resource type for the consent endpoints (auth-matrix `resources`). */
export const CONSENT_RECORDS_RESOURCE_TYPE = 'consent_records';

/**
 * Purposes a customer may NOT submit via the tokenised micro-site (FR-110 LLD
 * §Validation `CustomerConsentDto`: customer-capturable = all except these).
 */
export const CUSTOMER_BLOCKED_PURPOSES: ReadonlySet<ConsentPurpose> = new Set([
  ConsentPurpose.PARTNER_SHARING,
  ConsentPurpose.AA_BANK_DATA,
  ConsentPurpose.GST_BUSINESS_DATA,
]);

/** Hard LIMIT for the internal latest-per-purpose derivation read (NFR-17). */
export const LATEST_PER_PURPOSE_LIMIT = 100;
