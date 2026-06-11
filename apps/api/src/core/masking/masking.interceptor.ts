import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import {
  MASKING_LEVEL_KEY,
  type AbacRequestContext,
  type MaskingLevel,
} from '../auth/abac-context';
import { MaskingService, type MaskableField } from './masking.service';

/**
 * Maps an outbound PII field name (as it appears in API payloads / the data
 * model) to the masker's field kind. Only these keys are masked; everything else
 * passes through untouched.
 */
const FIELD_MAP: Readonly<Record<string, MaskableField>> = {
  mobile: 'mobile',
  pan_masked: 'pan',
  aadhaar_ref_token: 'aadhaar',
  email: 'email',
  full_name: 'full_name',
  name: 'full_name',
};

/**
 * FR-002 — serialisation-layer PII masking (architecture §; runs after the
 * response-envelope interceptor). It masks **only** when {@link AbacGuard} marked
 * the request with a masking level — i.e. on an ABAC-scoped (`@Requires`) data
 * response. Public/authn responses (FR-001) carry no masking level and are never
 * touched, so this interceptor is inert outside lead-data endpoints. `strict`
 * (DPO masked view / export) additionally reduces `full_name` to the first name;
 * raw values are never produced here (unmasking is the explicit FR-003 path).
 */
@Injectable()
export class MaskingInterceptor implements NestInterceptor {
  constructor(private readonly masking: MaskingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AbacRequestContext>();
    const level = req[MASKING_LEVEL_KEY];
    if (!level) {
      // Not an ABAC-scoped response — do not mutate (keeps FR-001 etc. untouched).
      return next.handle();
    }
    const strict = level === 'strict';
    return next.handle().pipe(map((body) => this.maskDeep(body, strict, new WeakSet())));
  }

  /**
   * Recursively mask known PII keys in a JSON-serialisable value. Cycles are
   * guarded with a WeakSet; non-plain values (Date, etc.) are returned as-is.
   */
  private maskDeep(value: unknown, strict: boolean, seen: WeakSet<object>): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskDeep(item, strict, seen));
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (value instanceof Date) {
      return value;
    }
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      const fieldKind = FIELD_MAP[key];
      if (fieldKind != null && (typeof child === 'string' || child === null)) {
        out[key] = this.masking.mask(fieldKind, child as string | null, { strict });
      } else {
        out[key] = this.maskDeep(child, strict, seen);
      }
    }
    return out;
  }
}

export type { MaskingLevel };
