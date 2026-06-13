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
