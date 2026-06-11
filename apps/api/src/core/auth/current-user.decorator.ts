import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { AUTH_USER_KEY, type AuthUser, type RequestWithUser } from './auth-user';

/**
 * Injects the authenticated {@link AuthUser} that {@link JwtAuthGuard} placed on
 * the request. Use on protected handlers: `@CurrentUser() user: AuthUser`.
 * Returns `undefined` on a `@Public()` route (no token was validated), so a
 * handler that needs the user must be protected.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    return req[AUTH_USER_KEY];
  },
);
