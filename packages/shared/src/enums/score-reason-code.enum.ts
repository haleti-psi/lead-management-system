/**
 * FR-011 — Lead quality score reason codes. One value per scoring factor.
 * Single source of truth — shared by apps/api and apps/web.
 * Never redefine locally; import from `@lms/shared`.
 */
export const ScoreReasonCode = {
  MOBILE_VERIFIED: 'mobile_verified',
  PIN_PRESENT: 'pin_present',
  REQUESTED_AMOUNT_PRESENT: 'requested_amount_present',
  HIGH_AMOUNT: 'high_amount',
  LANGUAGE_PREFERENCE_SET: 'language_preference_set',
  PAN_PRESENT: 'pan_present',
  PAN_MISSING_PENALTY: 'pan_missing_penalty',
  PARTNER_QUALITY_GOOD: 'partner_quality_good',
  PARTNER_HIGH_RISK: 'partner_high_risk',
  SOURCE_HIGH_REJECTION: 'source_high_rejection',
  CUSTOMER_TYPE_BUSINESS: 'customer_type_business',
  EMPLOYMENT_TYPE_PRESENT: 'employment_type_present',
  ASSET_DETAILS_PRESENT: 'asset_details_present',
} as const;
export type ScoreReasonCode = typeof ScoreReasonCode[keyof typeof ScoreReasonCode];

/**
 * FR-031 — Hot-lead rule reason codes. One value per hot rule (H1–H8) plus
 * the COOLED code for the cool-down path. Carried in the `audit_logs.detail`
 * entry and the HOT_LEAD outbox event payload only — NOT written to
 * `leads.score_reasons` (FR-011 owns that column; FR-031 writes `is_hot`).
 * Never redefine locally; import from `@lms/shared`.
 */
export const HotReasonCode = {
  PRIORITY_HIGH: 'PRIORITY_HIGH',
  AMOUNT_ABOVE_THRESHOLD: 'AMOUNT_ABOVE_THRESHOLD',
  RETURNING_CUSTOMER: 'RETURNING_CUSTOMER',
  PARTNER_VERIFIED: 'PARTNER_VERIFIED',
  CUSTOMER_SUBMITTED_DOCS: 'CUSTOMER_SUBMITTED_DOCS',
  POSITIVE_LOS_INDICATIVE: 'POSITIVE_LOS_INDICATIVE',
  HIGH_INTENT_EVENT: 'HIGH_INTENT_EVENT',
  AMOUNT_ABOVE_DEFAULT_THRESHOLD: 'AMOUNT_ABOVE_DEFAULT_THRESHOLD',
  COOLED: 'COOLED',
} as const;
export type HotReasonCode = typeof HotReasonCode[keyof typeof HotReasonCode];
