import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../http/domain-exception';
import { readHeader } from '../http/http-types';
import { AUTH_USER_KEY, type RequestWithUser } from './auth-user';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenService } from './token.service';

/**
 * Global authentication guard (architecture §5; registered via `APP_GUARD`).
 * Every request is authenticated unless its handler/controller is `@Public()`.
 * Reads the access token from the `Authorization: Bearer` header only (the
 * refresh token, by contrast, is the httpOnly cookie read by the auth
 * controller), verifies it, and binds the decoded {@link AuthUser} on the
 * request for `@CurrentUser()` and the ABAC guard. Any missing/invalid/expired
 * token → `AUTH_REQUIRED` (401) with the generic, non-enumerating message.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(req);
    if (!token) {
      throw new DomainException(ERROR_CODES.AUTH_REQUIRED);
    }

    const user = await this.tokenService.verifyAccessToken(token);
    if (!user) {
      throw new DomainException(ERROR_CODES.AUTH_REQUIRED);
    }

    req[AUTH_USER_KEY] = user;
    return true;
  }

  /** The access token is presented as a Bearer token in the Authorization header. */
  private extractToken(req: RequestWithUser): string | undefined {
    const authHeader = readHeader(req, 'authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const value = authHeader.slice('Bearer '.length).trim();
      if (value.length > 0) return value;
    }
    return undefined;
  }
}
