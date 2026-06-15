import { Injectable } from '@nestjs/common';

import { IntegrationKind } from '@lms/shared';

/**
 * Wire payload sent to the LOS (LOS port HandoffRequest interface).
 * No raw PII — the LOS pulls KYC artefacts via secure doc references.
 */
export interface LosHandoffPayload {
  /** Non-PII reference for the LOS. */
  leadCode: string;
  productCode: string;
  /** Opaque applicant ref (lead_identity_id). */
  applicantRef: string;
  requestedAmount: string | null;
  branchCode: string | null;
  /** eligibility_snapshots.request_ref if present. */
  eligibilityRef: string | null;
  correlationId: string;
}

/** Minimal lead row needed to build the handoff payload. */
export interface HandoffLeadContext {
  lead_code: string;
  product_code: string;
  lead_identity_id: string;
  requested_amount: number | null;
  branch_code: string | null;
  eligibility_ref: string | null;
}

/**
 * FR-081 — assembles the product-specific payload for the LOS hand-off call.
 * No PII is included in the payload (LLD §Step 7).
 */
@Injectable()
export class LosHandoffPayloadBuilder {
  build(
    lead: HandoffLeadContext,
    correlationId: string,
  ): { integration: typeof IntegrationKind.LOS_HANDOFF; payload: LosHandoffPayload; maskedRequestRef: string } {
    const payload: LosHandoffPayload = {
      leadCode: lead.lead_code,
      productCode: lead.product_code,
      applicantRef: lead.lead_identity_id,
      requestedAmount: lead.requested_amount != null ? String(lead.requested_amount) : null,
      branchCode: lead.branch_code,
      eligibilityRef: lead.eligibility_ref,
      correlationId,
    };

    return {
      integration: IntegrationKind.LOS_HANDOFF,
      payload,
      maskedRequestRef: `los/handoff/${lead.lead_code}`,
    };
  }
}
