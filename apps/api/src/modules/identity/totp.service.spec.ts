import { authenticator } from 'otplib';

import type { AppConfigService } from '../../core/config';
import type { AppEnv } from '../../core/config/env.schema';
import { TotpService } from './totp.service';

function makeTotp(): TotpService {
  const config = {
    get: <K extends keyof AppEnv>(key: K): AppEnv[K] =>
      ({ TOKENIZATION_KMS_KEY: 'unit-kms-key', MFA_ISSUER: 'LMS TEST' } as Partial<AppEnv>)[key] as AppEnv[K],
    isProduction: false,
  } as AppConfigService;
  return new TotpService(config);
}

describe('TotpService', () => {
  it('encrypts a secret and decrypts it on verify (round-trip with a live OTP)', () => {
    const svc = makeTotp();
    const secret = svc.generateSecret();
    const encrypted = svc.encrypt(secret);

    // Ciphertext must not equal or contain the plaintext secret.
    expect(encrypted).not.toContain(secret);
    expect(encrypted.split(':')).toHaveLength(3);

    const currentOtp = authenticator.generate(secret);
    expect(svc.verify(currentOtp, encrypted)).toBe(true);
  });

  it('rejects a wrong OTP', () => {
    const svc = makeTotp();
    const encrypted = svc.encrypt(svc.generateSecret());
    expect(svc.verify('000000', encrypted)).toBe(false);
  });

  it('returns false (no throw) when the secret is null', () => {
    const svc = makeTotp();
    expect(svc.verify('123456', null)).toBe(false);
  });

  it('returns false (no throw) on a malformed/tampered ciphertext', () => {
    const svc = makeTotp();
    expect(svc.verify('123456', 'garbage-not-three-parts')).toBe(false);
  });

  it('builds an otpauth URI for QR enrolment', () => {
    const svc = makeTotp();
    const uri = svc.keyUri('JBSWY3DPEHPK3PXP', 'admin');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('admin');
  });
});
