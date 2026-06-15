/** FR-091 — a partner's own lead (masked; limited status). */
export interface PartnerLeadView {
  lead_id: string;
  lead_code: string;
  stage: string;
  product_code: string;
  duplicate_status: string;
  name_masked: string;
  mobile_masked: string;
  created_at: string;
}

/** FR-091 — create-response view (masked). */
export interface PartnerLeadCreateView {
  lead_id: string;
  lead_code: string;
  stage: string;
  product_code: string;
  consent_status: string;
  kyc_status: string;
  duplicate_status: string;
  name_masked: string | null;
  mobile_masked: string | null;
}

/** FR-091 — `POST /partners/leads` body (source/partner are server-forced). */
export interface PartnerLeadCreateBody {
  product_code: string;
  identity: { name: string; mobile: string; email?: string };
  sub_source?: string;
  pin_code?: string;
  requested_amount?: number;
}
