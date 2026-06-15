import { createHmac, timingSafeEqual } from 'node:crypto';

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ERROR_CODES } from '@lms/shared';

import { AppConfigService } from '../../core/config';
import { DomainException, readHeader, type HttpRequestLike } from '../../core/http';

/** Header the scan provider sends the SHA-256 HMAC (hex) of the raw body in. */
const SIGNATURE_HEADER = 'x-scan-signature';

/** Request augmented with the raw body buffer (NestJS `rawBody: true`). */
interface RawBodyRequest extends HttpRequestLike {
  rawBody?: Buffer;
}

/**
 * FR-070 — inbound HMAC guard for `POST /internal/documents/{did}/scan-result`
 * (LLD §Virus scan async callback: "service-to-service, HMAC-verified"). Mirrors
 * the FR-140 `LosWebhookGuard`: it recomputes
 * `HMAC-SHA256(rawBody, VIRUS_SCAN_API_KEY)` and constant-time-compares it to the
 * `x-scan-signature` header. A missing/short/mismatched signature → `FORBIDDEN`
 * (403). The secret comes from validated config (Secret Manager-injected env),
 * never a literal; if unset, verification cannot succeed → 403. The raw body is
 * never logged (security.md).
 */
@Injectable()
export class ScanCallbackGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(ScanCallbackGuard.name) private readonly logger: PinoLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();
    const secret = this.config.get('VIRUS_SCAN_API_KEY');

    if (!secret) {
      this.logger.error('Scan-result callback rejected: VIRUS_SCAN_API_KEY not configured');
      throw this.reject();
    }

    const signature = readHeader(request, SIGNATURE_HEADER);
    const rawBody = request.rawBody;
    if (typeof signature !== 'string' || signature.length === 0 || !Buffer.isBuffer(rawBody)) {
      this.logger.warn('Scan-result callback rejected: missing signature or raw body');
      throw this.reject();
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (signature.length !== expected.length) {
      this.logger.warn('Scan-result callback rejected: signature length mismatch');
      throw this.reject();
    }

    const ok = timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    if (!ok) {
      this.logger.warn('Scan-result callback rejected: signature mismatch');
      throw this.reject();
    }
    return true;
  }

  private reject(): DomainException {
    return new DomainException(ERROR_CODES.FORBIDDEN, 'Webhook signature mismatch.');
  }
}
