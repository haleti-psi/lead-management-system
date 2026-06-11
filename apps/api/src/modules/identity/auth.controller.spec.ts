import type { AppConfigService } from '../../core/config';
import type { AppEnv } from '../../core/config/env.schema';
import type { HttpRequestLike, HttpResponseLike } from '../../core/http/http-types';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { AuthOutcome } from './auth.types';

function makeConfig(): AppConfigService {
  return {
    get: <K extends keyof AppEnv>(key: K): AppEnv[K] =>
      ({ REFRESH_TOKEN_TTL: '7d' } as Partial<AppEnv>)[key] as AppEnv[K],
    isProduction: false,
  } as AppConfigService;
}

function makeRes(): { res: HttpResponseLike; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
    status: () => res,
    json: () => res,
  } as unknown as HttpResponseLike;
  return { res, headers };
}

const tokensOutcome: AuthOutcome = {
  kind: 'tokens',
  body: { access_token: 'access-x', token_type: 'Bearer', expires_in: 900, mfa_required: false },
  refreshToken: 'refresh-abc',
};

describe('AuthController', () => {
  it('login sets the refresh token as an httpOnly; Secure; SameSite=Strict cookie and returns the token body', async () => {
    const auth = { login: jest.fn(async () => tokensOutcome) } as unknown as AuthService;
    const controller = new AuthController(auth, makeConfig());
    const { res, headers } = makeRes();
    const req: HttpRequestLike = { headers: { 'user-agent': 'jest' } };

    const body = await controller.login({ username: 'rm', password: 'p' }, req, res);

    expect(body).toEqual(tokensOutcome.body);
    const cookie = headers['Set-Cookie'];
    expect(cookie).toContain('lms_refresh=refresh-abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('Max-Age=604800');
  });

  it('login with an MFA challenge returns the challenge body and sets no cookie', async () => {
    const challenge: AuthOutcome = {
      kind: 'challenge',
      body: { mfa_required: true, mfa_challenge_token: 'c', mfa_method: 'totp' },
    };
    const auth = { login: jest.fn(async () => challenge) } as unknown as AuthService;
    const controller = new AuthController(auth, makeConfig());
    const { res, headers } = makeRes();

    const body = await controller.login({ username: 'admin', password: 'p' }, { headers: {} }, res);

    expect(body).toEqual(challenge.body);
    expect(headers['Set-Cookie']).toBeUndefined();
  });

  it('refresh reads the lms_refresh cookie and passes it to the service', async () => {
    const refresh = jest.fn(async () => tokensOutcome);
    const auth = { refresh } as unknown as AuthService;
    const controller = new AuthController(auth, makeConfig());
    const { res } = makeRes();
    const req: HttpRequestLike = { headers: { cookie: 'other=1; lms_refresh=cookie-token; x=2' } };

    await controller.refresh(req, res);

    expect(refresh).toHaveBeenCalledWith('cookie-token', expect.objectContaining({ userAgent: undefined }));
  });

  it('reset always returns null (no enumeration) regardless of the email', async () => {
    const initiatePasswordReset = jest.fn(async () => undefined);
    const auth = { initiatePasswordReset } as unknown as AuthService;
    const controller = new AuthController(auth, makeConfig());

    const out = await controller.reset({ email: 'a@b.com' }, { headers: {} });
    expect(out).toBeNull();
    expect(initiatePasswordReset).toHaveBeenCalledWith('a@b.com', expect.any(Object));
  });
});
