import { Injectable } from '@nestjs/common';

/** PII field kinds the masker understands (FR-002 §Masking Rules). */
export type MaskableField = 'mobile' | 'pan' | 'aadhaar' | 'email' | 'full_name';

export interface MaskOptions {
  /**
   * When true, an active break-glass grant authorises the raw value — masking is
   * bypassed (the *caller* is responsible for auditing the unmasked access). This
   * is never set by the default response interceptor; only the explicit unmask
   * path (FR-003) passes it.
   */
  readonly breakGlassActive?: boolean;
  /**
   * Strictest masking (DPO masked view / any export): also reduces `full_name`
   * to the first name. Partial-strength fields (mobile/pan/aadhaar/email) mask
   * identically at every level — DPO never receives raw PII.
   */
  readonly strict?: boolean;
}

/**
 * FR-002 — the role-based PII masker. Pure, deterministic string transforms used
 * by the {@link MaskingInterceptor} on every outbound response and by exports
 * (strictest). Raw Aadhaar is never stored or returned; only a token suffix
 * (last 4) is ever shown. The masks are fixed-width (not length-proportional) so
 * the masked form never leaks the original length.
 */
@Injectable()
export class MaskingService {
  /** Mask a single field by kind; `null`/empty passes through unchanged. */
  mask(field: MaskableField, value: string | null | undefined, options: MaskOptions = {}): string | null {
    if (value == null || value === '') {
      return value ?? null;
    }
    if (options.breakGlassActive) {
      return value;
    }
    switch (field) {
      case 'mobile':
        return this.maskMobile(value);
      case 'pan':
        return this.maskPan(value);
      case 'aadhaar':
        return this.maskAadhaar(value);
      case 'email':
        return this.maskEmail(value);
      case 'full_name':
        return options.strict ? this.firstNameOnly(value) : value;
      default:
        return value;
    }
  }

  /** `9876543210` → `98xxxxxx10` (first 2 + fixed 6 mask + last 2). */
  private maskMobile(mobile: string): string {
    if (mobile.length <= 4) return 'xxxxxx';
    return `${mobile.slice(0, 2)}xxxxxx${mobile.slice(-2)}`;
  }

  /** `ABCDE1234F` → `ABCxxxx4F` (first 3 + fixed 4 mask + last 2). */
  private maskPan(pan: string): string {
    if (pan.length <= 5) return 'xxxx';
    return `${pan.slice(0, 3)}xxxx${pan.slice(-2)}`;
  }

  /**
   * Aadhaar reference token → last 4 characters only (never the full token, never
   * a raw Aadhaar number). A trailing numeric group is preferred (`TOKEN_ABCD_1234`
   * → `1234`); otherwise the final 4 characters.
   */
  private maskAadhaar(token: string): string {
    const trailingDigits = /(\d{4})\D*$/.exec(token);
    if (trailingDigits?.[1]) {
      return trailingDigits[1];
    }
    return token.slice(-4);
  }

  /** `abc@example.com` → `ab****@example.com` (first 2 of local + **** + domain). */
  private maskEmail(email: string): string {
    const at = email.indexOf('@');
    if (at <= 0) {
      // No local part / not an address shape — mask conservatively.
      return '****';
    }
    const local = email.slice(0, at);
    const domain = email.slice(at); // includes '@'
    const prefix = local.slice(0, 2);
    return `${prefix}****${domain}`;
  }

  /** Reduce a full name to its first token (strict / DPO / export). */
  private firstNameOnly(name: string): string {
    const first = name.trim().split(/\s+/)[0];
    return first ?? name;
  }
}
