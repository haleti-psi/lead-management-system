import { JwtService } from '@nestjs/jwt';

import { RoleCode, DataScope } from '@lms/shared';

import type { AppConfigService } from '../config';
import type { AppEnv } from '../config/env.schema';
import { TokenService, parseDurationSeconds } from './token.service';

function configFor(values: Partial<AppEnv>): AppConfigService {
  return {
    get: <K extends keyof AppEnv>(key: K): AppEnv[K] => values[key] as AppEnv[K],
    isProduction: false,
  } as AppConfigService;
}

function makeService(): TokenService {
  const config = configFor({
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    ACCESS_TOKEN_TTL: '15m',
  });
  return new TokenService(new JwtService({}), config);
}

describe('parseDurationSeconds', () => {
  it.each([
    ['15m', 900],
    ['30s', 30],
    ['2h', 7200],
    ['7d', 604_800],
    ['45', 45],
  ])('parses %s → %d seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected);
  });

  it('throws on a malformed duration', () => {
    expect(() => parseDurationSeconds('abc')).toThrow();
  });
});

describe('TokenService', () => {
  it('signs an access token and verifies it back into an AuthUser', async () => {
    const svc = makeService();
    const { token, expiresIn } = await svc.signAccessToken({
      userId: 'u1',
      orgId: 'org1',
      role: RoleCode.RM,
      scope: DataScope.O,
    });
    expect(expiresIn).toBe(900);

    const user = await svc.verifyAccessToken(token);
    expect(user).toEqual({ userId: 'u1', orgId: 'org1', role: RoleCode.RM, scope: DataScope.O, jti: expect.any(String) });
  });

  it('returns null for a garbage access token (no throw)', async () => {
    const svc = makeService();
    expect(await svc.verifyAccessToken('not.a.jwt')).toBeNull();
  });

  it('does not accept an MFA-challenge token as an access token (purpose separation)', async () => {
    const svc = makeService();
    const challenge = await svc.signMfaChallenge('u1');
    // Wrong audience: verifying a challenge token as an access token must fail.
    expect(await svc.verifyAccessToken(challenge)).toBeNull();
  });

  it('verifies an MFA-challenge token only as its own purpose', async () => {
    const svc = makeService();
    const challenge = await svc.signMfaChallenge('u1');
    expect(await svc.verifyPurpose(challenge, 'mfa_challenge')).toMatchObject({ sub: 'u1', type: 'mfa_challenge' });
    // A challenge token must not validate as a password-reset token.
    expect(await svc.verifyPurpose(challenge, 'pw_reset')).toBeNull();
  });

  it('verifies a password-reset token round-trip', async () => {
    const svc = makeService();
    const reset = await svc.signPasswordReset('u9');
    expect(await svc.verifyPurpose(reset, 'pw_reset')).toMatchObject({ sub: 'u9', type: 'pw_reset' });
  });
});
