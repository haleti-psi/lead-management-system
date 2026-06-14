/** ABAC resource type for the staff customer-link endpoint (auth-matrix `customer_links`). */
export const CUSTOMER_LINK_RESOURCE_TYPE = 'customer_links';

/** OTP time-to-live (seconds) — LLD §C "OTP TTL: 10 minutes". */
export const OTP_TTL_SECONDS = 600;

/** Verified-session TTL (seconds) — the OTP step-up session window. */
export const SESSION_TTL_SECONDS = 1800;

/** OTP attempts allowed per link per window before RATE_LIMITED (LLD §3). */
export const OTP_MAX_ATTEMPTS = 10;
export const OTP_ATTEMPT_WINDOW_SECONDS = 600;

/** Allowed customer-link purposes (LLD §1 — CreateCustomerLinkDto). */
export const LINK_PURPOSES = ['upload', 'consent', 'status', 'callback', 'grievance'] as const;
export type LinkPurpose = (typeof LINK_PURPOSES)[number];

/** Default link validity (days) when the request omits `expires_in_days`. */
export const DEFAULT_LINK_TTL_DAYS = 7;

/** Redis key builders (one namespace per concern, keyed by customer_link_id). */
export const REDIS_KEYS = {
  otp: (id: string): string => `otp:${id}`,
  otpAttempts: (id: string): string => `otplimit:${id}`,
  session: (id: string): string => `clsession:${id}`,
} as const;
