import { Injectable } from '@nestjs/common';

/** PII field names that must never appear in the LOS payload (LLD §Payload Builder). */
const PII_FIELD_NAMES = new Set([
  'name',
  'mobile',
  'mobile_no',
  'pan',
  'pan_token',
  'aadhaar',
  'aadhaar_ref_token',
  'email',
  'dob',
  'full_name',
]);

export interface EligibilityPayloadBuilderInput {
  leadCode: string;
  productCode: string;
  sourceChannel: string;
  kycStatus: string;
  consentRef: string;
  eligibilityMapping: Record<string, string>;
  attributes: Record<string, unknown>;
}

/** The outbound LOS eligibility payload (LLD §External Service Calls). */
export interface LosEligibilityPayload {
  leadCode: string;
  productCode: string;
  sourceChannel: string;
  consentRef: string;
  kycStatus: string;
  attributes: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * FR-080 — builds the LOS eligibility payload from a ProductConfig's
 * `eligibility_mapping` + `lead_product_details.attributes`.
 *
 * The mapping is a flat key-value map where keys are LMS attribute field names
 * and values are the LOS payload field names (LLD §Assumptions 3). PII field
 * names are never included in the mapped attributes (LLD §Payload Builder).
 *
 * `idempotencyKey` (request_ref) is always injected by the caller.
 */
@Injectable()
export class EligibilityPayloadBuilder {
  build(
    input: EligibilityPayloadBuilderInput,
    requestRef: string,
  ): LosEligibilityPayload {
    const mappedAttributes: Record<string, unknown> = {};

    for (const [lmsField, losField] of Object.entries(input.eligibilityMapping)) {
      // Skip PII fields even if they appear in the mapping (safety net)
      if (PII_FIELD_NAMES.has(lmsField.toLowerCase()) || PII_FIELD_NAMES.has(losField.toLowerCase())) {
        continue;
      }
      mappedAttributes[losField] = input.attributes[lmsField];
    }

    return {
      leadCode: input.leadCode,
      productCode: input.productCode,
      sourceChannel: input.sourceChannel,
      consentRef: input.consentRef,
      kycStatus: input.kycStatus,
      attributes: mappedAttributes,
      idempotencyKey: requestRef,
    };
  }
}
