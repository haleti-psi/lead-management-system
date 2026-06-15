/** FR-060 — `GET /c/{token}` landing response (mirrors CustomerOpenData). */
export interface CustomerOpenData {
  customer_link_id: string;
  lead_id: string;
  purpose: string[];
  otp_required: boolean;
  otp_verified: boolean;
  lead_display: { product_display_name: string; status_label: string };
}

/** FR-060 — `POST /c/{token}/otp` response. */
export interface VerifyOtpData {
  otp_verified: boolean;
  session_expires_at: string;
}
