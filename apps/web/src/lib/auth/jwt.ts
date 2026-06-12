import type { DataScope, RoleCode } from '@lms/shared';

/**
 * The authenticated user, derived by decoding the in-memory access-token JWT
 * (FR-001: payload `{ sub, org_id, role, scope, jti }`). The token is verified
 * server-side on every request; the client only READS the claims to drive
 * role-filtered nav and UI affordances — it never trusts them for authorization.
 */
export interface AuthUser {
  userId: string;
  orgId: string;
  role: RoleCode;
  scope: DataScope;
}

interface AccessTokenClaims {
  sub?: string;
  org_id?: string;
  role?: string;
  scope?: string;
}

/** Decode the access-token JWT payload into an `AuthUser`, or `null` if the
 * token is malformed or missing required claims. No signature check (server's
 * job); no third-party library (manual base64url decode). */
export function decodeAccessToken(token: string): AuthUser | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  const payload = base64UrlDecode(segments[1]);
  if (payload === null) return null;

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(payload) as AccessTokenClaims;
  } catch {
    return null;
  }

  const { sub, org_id: orgId, role, scope } = claims;
  if (!sub || !orgId || !role || !scope) return null;

  return { userId: sub, orgId, role: role as RoleCode, scope: scope as DataScope };
}

function base64UrlDecode(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return atob(padded);
  } catch {
    return null;
  }
}
