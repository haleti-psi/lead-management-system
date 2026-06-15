/** FR-092 — partner quality response (mirrors PartnerQualityData). */
export interface PartnerQualityData {
  partner_id: string;
  partner_code: string;
  legal_name: string;
  type: string;
  status: string;
  quality_score: number | null;
  insufficient_data: boolean;
  window: { from: string; to: string };
  metrics: {
    total_leads: number;
    contactable_leads: number;
    duplicate_leads: number;
    rejected_leads: number;
    handed_off_leads: number;
    uploaded_docs: number;
    verified_docs_first_time: number;
    kyc_mismatch_leads: number;
  };
  factors: {
    contactability_index: number | null;
    duplicate_penalty: number | null;
    rejection_penalty: number | null;
    handoff_index: number | null;
    document_quality_index: number | null;
    speed_index: number | null;
  };
  factor_weights: Record<string, number>;
}
