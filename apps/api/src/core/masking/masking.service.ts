import { Injectable } from '@nestjs/common';

/** PII field kinds the masker understands (FR-002 §Masking Rules). */
export type MaskableField = 'mobile' | 'pan' | 'aadhaar' | 'email' | 'full_name';

/** Fixed token substituted for PII fields that have no format-preserving mask. */
export const REDACTED_TOKEN = '[REDACTED]';

/**
 * Format-maskable PII keys in a domain-event payload → the masker field kind
 * that knows how to mask that format. Mirrors the response interceptor's
 * FIELD_MAP, extended with the event-only identifier aliases the FR-141 LLD
 * lists (pan_token alongside pan_masked, aadhaar_ref_token, name).
 */
const EVENT_PAYLOAD_FORMAT_FIELDS: Readonly<Record<string, MaskableField>> = {
  mobile: 'mobile',
  pan: 'pan',
  pan_token: 'pan',
  pan_masked: 'pan',
  aadhaar: 'aadhaar',
  aadhaar_ref_token: 'aadhaar',
  email: 'email',
  name: 'full_name',
  full_name: 'full_name',
};

/**
 * PII keys with no defined partial mask (FR-141 LLD §Validation Logic). These
 * carry no format the masker can preserve, so they are wholly redacted — never
 * emitted to the outbox, even as a derived value. `ckyc_id` is included here
 * (treated as an opaque identifier, not a last-4 token like aadhaar_ref_token).
 */
const EVENT_PAYLOAD_REDACT_FIELDS: ReadonlySet<string> = new Set(['ckyc_id', 'dob', 'address']);

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

  /**
   * Mask every PII field in a domain-event payload before it is written to the
   * transactional outbox (FR-141). The outbox is an analytics / AI-readiness
   * sink, so the **strictest** masking is always applied and break-glass is
   * never honoured — raw PII must never enter the event store. Returns a new
   * deeply-cloned object; the input is not mutated. Cycles are guarded.
   *
   * - Format-shaped fields (mobile/pan/aadhaar/email/name) are masked by their
   *   {@link mask} primitive.
   * - Identifier fields with no partial mask (ckyc_id/dob/address) are replaced
   *   with {@link REDACTED_TOKEN}.
   * - Every other key is preserved as-is (recursing into nested objects/arrays).
   */
  maskEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return this.maskPayloadDeep(payload, new WeakSet()) as Record<string, unknown>;
  }

  private maskPayloadDeep(value: unknown, seen: WeakSet<object>): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskPayloadDeep(item, seen));
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) {
      return value;
    }
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (EVENT_PAYLOAD_REDACT_FIELDS.has(key) && child != null) {
        out[key] = REDACTED_TOKEN;
        continue;
      }
      const fieldKind = EVENT_PAYLOAD_FORMAT_FIELDS[key];
      if (fieldKind != null && (typeof child === 'string' || child === null)) {
        out[key] = this.mask(fieldKind, child as string | null, { strict: true });
      } else {
        out[key] = this.maskPayloadDeep(child, seen);
      }
    }
    return out;
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
