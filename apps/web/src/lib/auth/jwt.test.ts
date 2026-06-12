// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { decodeAccessToken } from './jwt';

function seg(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function makeJwt(payload: object): string {
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(payload)}.signature`;
}

describe('decodeAccessToken', () => {
  it('extracts the AuthUser from a well-formed access token', () => {
    const token = makeJwt({ sub: 'u-1', org_id: 'o-1', role: 'RM', scope: 'O', jti: 'j-1' });
    expect(decodeAccessToken(token)).toEqual({ userId: 'u-1', orgId: 'o-1', role: 'RM', scope: 'O' });
  });

  it('returns null when the token does not have three segments', () => {
    expect(decodeAccessToken('header.payload')).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    // "Zm9v" is valid base64 ("foo") but not JSON.
    expect(decodeAccessToken('header.Zm9v.sig')).toBeNull();
  });

  it('returns null when a required claim is missing', () => {
    const token = makeJwt({ sub: 'u-1', org_id: 'o-1', role: 'RM' }); // no scope
    expect(decodeAccessToken(token)).toBeNull();
  });
});
