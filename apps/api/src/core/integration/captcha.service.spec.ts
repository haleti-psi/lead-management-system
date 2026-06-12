import { ERROR_CODES } from '@lms/shared';

import { CaptchaMockAdapter, CAPTCHA_MOCK_INVALID_TOKEN } from './adapters/captcha-mock.adapter';
import { CaptchaService } from './captcha.service';

/**
 * FR-010 — public-capture captcha gate (shared-utilities `CaptchaService.verify`;
 * AMBIGUITIES C3). Failure is always the taxonomy FORBIDDEN (403); the token is
 * never logged.
 */
describe('CaptchaMockAdapter', () => {
  const adapter = new CaptchaMockAdapter();

  it('accepts any non-empty token', async () => {
    await expect(adapter.verifyToken('recaptcha-v3-token')).resolves.toBe(true);
  });

  it('rejects empty/whitespace tokens and the invalid sentinel', async () => {
    await expect(adapter.verifyToken('')).resolves.toBe(false);
    await expect(adapter.verifyToken('   ')).resolves.toBe(false);
    await expect(adapter.verifyToken(CAPTCHA_MOCK_INVALID_TOKEN)).resolves.toBe(false);
  });
});

describe('CaptchaService.verify', () => {
  const logger = { warn: jest.fn(), error: jest.fn() } as never;

  it('resolves for a valid token', async () => {
    const service = new CaptchaService({ verifyToken: jest.fn().mockResolvedValue(true) }, logger);
    await expect(service.verify('ok-token')).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when the provider rejects the token', async () => {
    const service = new CaptchaService({ verifyToken: jest.fn().mockResolvedValue(false) }, logger);
    await expect(service.verify('bad-token')).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('throws FORBIDDEN for a missing token without calling the provider', async () => {
    const verifyToken = jest.fn();
    const service = new CaptchaService({ verifyToken }, logger);
    await expect(service.verify(undefined)).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    await expect(service.verify('   ')).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(verifyToken).not.toHaveBeenCalled();
  });
});
