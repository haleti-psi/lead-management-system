import { Injectable } from '@nestjs/common';

import type { CaptchaPort } from '../ports/captcha.port';

/**
 * Deterministic captcha test double (FR-010; no real vendor call — OD-08/OD-17).
 * Mirrors the LOS/KYC mock-adapter convention: a fixed sentinel drives the
 * failure path so dev/e2e flows can exercise the 403 branch without a provider.
 *
 *  - empty / whitespace token        → invalid
 *  - {@link CAPTCHA_MOCK_INVALID_TOKEN} → invalid
 *  - anything else                   → valid
 */
export const CAPTCHA_MOCK_INVALID_TOKEN = 'invalid-captcha';

@Injectable()
export class CaptchaMockAdapter implements CaptchaPort {
  verifyToken(token: string): Promise<boolean> {
    const trimmed = token.trim();
    return Promise.resolve(trimmed.length > 0 && trimmed !== CAPTCHA_MOCK_INVALID_TOKEN);
  }
}
