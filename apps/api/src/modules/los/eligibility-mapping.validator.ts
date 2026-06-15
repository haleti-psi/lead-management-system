import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../core/http';

export interface EligibilityMappingValidatorInput {
  eligibilityMapping: Record<string, string> | null;
  productCode: string;
  attributes: Record<string, unknown> | null;
}

/**
 * FR-080 — validates that a ProductConfig's `eligibility_mapping` is present
 * and complete, and that all required attributes exist in `lead_product_details`.
 *
 * Throws `VALIDATION_ERROR` (400) for:
 * - null/empty mapping
 * - attributes missing in `lead_product_details.attributes`
 */
@Injectable()
export class EligibilityMappingValidator {
  validate(input: EligibilityMappingValidatorInput): void {
    const { eligibilityMapping, productCode, attributes } = input;

    // Mapping must be present and non-empty
    if (!eligibilityMapping || Object.keys(eligibilityMapping).length === 0) {
      throw new DomainException(
        ERROR_CODES.VALIDATION_ERROR,
        'Product configuration has no eligibility mapping. Contact IT.',
      );
    }

    // Every LMS field referenced in the mapping must have a non-null value
    for (const [lmsField] of Object.entries(eligibilityMapping)) {
      const value = attributes ? attributes[lmsField] : undefined;
      if (value === null || value === undefined) {
        throw new DomainException(
          ERROR_CODES.VALIDATION_ERROR,
          `Eligibility mapping is incomplete for product ${productCode}. Required attribute '${lmsField}' is missing from lead product details.`,
        );
      }
    }
  }
}
