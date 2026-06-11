import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RoleCode, DataScope } from '@lms/shared';

import { DomainException } from '../http/domain-exception';
import { AUTH_USER_KEY, type AuthUser, type RequestWithUser } from './auth-user';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { TokenService } from './token.service';

const VALID_USER: AuthUser = {
  userId: 'u1',
  orgId: 'org1',
  role: RoleCode.RM,
  scope: DataScope.O,
  jti: 'jti1',
};

function contextFor(req: RequestWithUser, isPublic = false): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: <T>(): T => req as T }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

function tokenServiceReturning(user: AuthUser | null): TokenService {
  return { verifyAccessToken: jest.fn(async () => user) } as unknown as TokenService;
}

describe('JwtAuthGuard', () => {
  it('lets a @Public() route through without a token', async () => {
    const { ctx, reflector } = contextFor({ headers: {} }, true);
    const guard = new JwtAuthGuard(reflector, tokenServiceReturning(null));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
  });

  it('rejects a protected route with no Authorization header → AUTH_REQUIRED', async () => {
    const { ctx, reflector } = contextFor({ headers: {} }, false);
    const guard = new JwtAuthGuard(reflector, tokenServiceReturning(VALID_USER));
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects an invalid bearer token → AUTH_REQUIRED', async () => {
    const req: RequestWithUser = { headers: { authorization: 'Bearer bad' } };
    const { ctx, reflector } = contextFor(req, false);
    const guard = new JwtAuthGuard(reflector, tokenServiceReturning(null));
    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).httpStatus).toBe(401);
  });

  it('accepts a valid bearer token and binds the AuthUser on the request', async () => {
    const req: RequestWithUser = { headers: { authorization: 'Bearer good' } };
    const { ctx, reflector } = contextFor(req, false);
    const guard = new JwtAuthGuard(reflector, tokenServiceReturning(VALID_USER));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req[AUTH_USER_KEY]).toEqual(VALID_USER);
  });

  it('ignores a non-Bearer Authorization scheme', async () => {
    const req: RequestWithUser = { headers: { authorization: 'Basic abc' } };
    const { ctx, reflector } = contextFor(req, false);
    const guard = new JwtAuthGuard(reflector, tokenServiceReturning(VALID_USER));
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
