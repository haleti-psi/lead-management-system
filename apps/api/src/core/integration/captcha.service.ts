import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../http/domain-exception';
import { CAPTCHA_PORT, type CaptchaPort } from './ports/captcha.port';

/**
 * `CaptchaService.verify(token)` — the pinned shared utility
 * (docs/contracts/shared-utilities.md) guarding the public capture endpoint
 * (FR-010 `POST /public/leads`). A missing or failed captcha is a `FORBIDDEN`
 * (403) per the FR-010 LLD §Auth Check; the token value itself is never logged.
 */
@Injectable()
export class CaptchaService {
  constructor(
    @Inject(CAPTCHA_PORT) private readonly captcha: CaptchaPort,
    @InjectPinoLogger(CaptchaService.name) private readonly logger: PinoLogger,
  ) {}

  /** Throws `FORBIDDEN` unless `token` is present and verifies with the provider. */
  async verify(token: string | undefined): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    const ok = await this.captcha.verifyToken(token);
    if (!ok) {
      this.logger.warn('Public capture captcha verification failed');
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }
}
