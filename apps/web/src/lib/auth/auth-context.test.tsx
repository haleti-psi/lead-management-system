// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider, useAuth, type LoginResult } from './auth-context';
import { setAccessToken } from '../api';

function seg(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function makeJwt(payload: object): string {
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(payload)}.sig`;
}
const RM_JWT = makeJwt({ sub: 'u-1', org_id: 'o-1', role: 'RM', scope: 'O' });

const tokenBody = (accessToken: string): Record<string, unknown> => ({
  access_token: accessToken,
  token_type: 'Bearer',
  expires_in: 900,
  mfa_required: false,
});

const okEnv = (data: unknown): Response =>
  new Response(JSON.stringify({ data, meta: { correlation_id: 'c' }, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errEnv = (status: number, code: string): Response =>
  new Response(
    JSON.stringify({ data: null, meta: { correlation_id: 'c' }, error: { code, message: 'x', retryable: false } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const wrapper = ({ children }: { children: ReactNode }): ReactElement => <AuthProvider>{children}</AuthProvider>;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Mount the hook with a bootstrap-refresh response queued first, and wait for
 * the initial `isLoading` to settle. */
async function mountSettled(bootstrap: Response) {
  fetchMock.mockResolvedValueOnce(bootstrap);
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
}

describe('useAuth', () => {
  it('restores the session on mount when the refresh cookie is valid', async () => {
    const { result } = await mountSettled(okEnv(tokenBody(RM_JWT)));
    expect(result.current.user).toMatchObject({ userId: 'u-1', role: 'RM', scope: 'O' });
  });

  it('starts unauthenticated when the bootstrap refresh fails', async () => {
    const { result } = await mountSettled(errEnv(401, 'AUTH_REQUIRED'));
    expect(result.current.user).toBeNull();
  });

  it('logs in without MFA and sets the user', async () => {
    const { result } = await mountSettled(errEnv(401, 'AUTH_REQUIRED'));
    fetchMock.mockResolvedValueOnce(okEnv(tokenBody(RM_JWT)));

    let outcome: LoginResult | undefined;
    await act(async () => {
      outcome = await result.current.login('rm-user', 'pw');
    });

    expect(outcome).toEqual({ mfaRequired: false });
    expect(result.current.user).toMatchObject({ userId: 'u-1', role: 'RM' });
  });

  it('surfaces an MFA challenge then completes login via verifyMfa', async () => {
    const { result } = await mountSettled(errEnv(401, 'AUTH_REQUIRED'));
    fetchMock.mockResolvedValueOnce(
      okEnv({ mfa_required: true, mfa_challenge_token: 'ch-1', mfa_method: 'totp' }),
    );

    let outcome: LoginResult | undefined;
    await act(async () => {
      outcome = await result.current.login('admin', 'pw');
    });

    expect(outcome).toEqual({ mfaRequired: true, challengeToken: 'ch-1', method: 'totp' });
    expect(result.current.user).toBeNull();

    fetchMock.mockResolvedValueOnce(okEnv(tokenBody(RM_JWT)));
    await act(async () => {
      await result.current.verifyMfa('ch-1', '482910');
    });
    expect(result.current.user).toMatchObject({ userId: 'u-1' });
  });

  it('clears the user on logout', async () => {
    const { result } = await mountSettled(okEnv(tokenBody(RM_JWT)));
    expect(result.current.user).not.toBeNull();

    act(() => {
      result.current.logout();
    });
    expect(result.current.user).toBeNull();
  });
});
