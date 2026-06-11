import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ERROR_CODES } from '@lms/shared';

import { AppConfigService } from '../../config';
import { DomainException } from '../../http/domain-exception';
import { readHeader, type HttpRequestLike } from '../../http/http-types';

/** Header LOS sends the SHA-256 HMAC (hex) of the raw request body in. */
const SIGNATURE_HEADER = 'x-los-signature';

/** Request augmented with the raw body buffer (NestJS `rawBody: true`). */
interface RawBodyRequest extends HttpRequestLike {
  rawBody?: Buffer;
}

/**
 * FR-140 inbound-webhook HMAC guard (LLD §Validation Logic — LosWebhookGuard).
 * Applied by FR-082 to `POST /api/v1/los/webhooks/status` (a
 * `service_to_service_only` route — NOT a JWT endpoint). FR-140 owns the guard
 * infrastructure; FR-082 wires it onto its controller.
 *
 * It recomputes `HMAC-SHA256(rawBody, LOS_WEBHOOK_HMAC_SECRET)` and compares it
 * to the `x-los-signature` header with {@link timingSafeEqual} (constant-time —
 * no timing oracle). A missing/short/mismatched signature is rejected with
 * `FORBIDDEN` (403); nothing downstream runs. The rejection is logged WITHOUT the
 * raw body (security.md: never log payloads/secrets).
 *
 * The secret comes from the validated config (Secret Manager-injected env), never
 * a literal. If it is not configured, verification cannot succeed → 403 (the
 * route must not process unverifiable webhooks).
 */
@Injectable()
export class LosWebhookGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(LosWebhookGuard.name) private readonly logger: PinoLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();
    const secret = this.config.get('LOS_WEBHOOK_HMAC_SECRET');

    if (!secret) {
      this.logger.error('LOS webhook rejected: LOS_WEBHOOK_HMAC_SECRET not configured');
      throw this.reject();
    }

    const signature = readHeader(request, SIGNATURE_HEADER);
    const rawBody = request.rawBody;
    if (typeof signature !== 'string' || signature.length === 0 || !Buffer.isBuffer(rawBody)) {
      this.logger.warn('LOS webhook rejected: missing signature or raw body');
      throw this.reject();
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    // Compare in constant time. Lengths must match first — timingSafeEqual
    // throws on unequal-length buffers, which would itself leak length via the
    // exception path, so we gate on length explicitly.
    if (signature.length !== expected.length) {
      this.logger.warn('LOS webhook rejected: signature length mismatch');
      throw this.reject();
    }

    const ok = timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    if (!ok) {
      this.logger.warn('LOS webhook rejected: signature mismatch');
      throw this.reject();
    }

    return true;
  }

  private reject(): DomainException {
    return new DomainException(ERROR_CODES.FORBIDDEN, 'Webhook signature mismatch.');
  }
}
