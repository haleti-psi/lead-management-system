import type { DataScope, RoleCode } from '@lms/shared';

import type { HttpRequestLike } from '../http/http-types';

/**
 * The authenticated principal, decoded from a valid access token by
 * {@link JwtAuthGuard} and attached to the request. ABAC attributes
 * (branch/team/region/partner) ride here so downstream guards/services scope
 * data without re-querying. This is the only shape `@CurrentUser()` returns.
 */
export interface AuthUser {
  /** users.user_id (JWT `sub`). */
  readonly userId: string;
  /** users.org_id. */
  readonly orgId: string;
  /** roles.code — drives the capability matrix. */
  readonly role: RoleCode;
  /** roles.default_scope — the caller's default data scope. */
  readonly scope: DataScope;
  /** Access-token id; lets the session be correlated/revoked. */
  readonly jti: string;
}

/** Property key under which the authenticated user is bound on the request. */
export const AUTH_USER_KEY = 'authUser' as const;

/** A request that has passed {@link JwtAuthGuard} carries the decoded user. */
export interface RequestWithUser extends HttpRequestLike {
  [AUTH_USER_KEY]?: AuthUser;
}
