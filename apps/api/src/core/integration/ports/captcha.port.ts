/**
 * Captcha verification boundary for the public capture endpoint (FR-010
 * `/public/leads`; AMBIGUITIES.md C3 — resolved: `CaptchaService` is a pinned
 * shared utility in `core/integration`, vendored per OD-08/OD-17). Hexagonal per
 * ADR-4: consumers depend on {@link CaptchaService}, which depends only on this
 * port; the real reCAPTCHA-v3 adapter (reads `CAPTCHA_SECRET`,
 * environment-contract.md §Provider variables) is the swap-last item — until the
 * vendor lands, {@link CaptchaMockAdapter} is the bound implementation.
 */
export interface CaptchaPort {
  /** True when the captcha token is valid for this request. Never throws for an invalid token. */
  verifyToken(token: string): Promise<boolean>;
}

/** DI token for {@link CaptchaPort}. */
export const CAPTCHA_PORT = Symbol('CAPTCHA_PORT');
