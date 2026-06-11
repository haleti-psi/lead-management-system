import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../http/domain-exception';
import type { HttpResponseLike } from '../http/http-types';

/**
 * Global rate-limit guard. Keys by client IP (auth/OTP/reset are 10/min per IP,
 * security.md). On limit breach it sets `Retry-After` and raises the taxonomy
 * `RATE_LIMITED` (429) via {@link DomainException}, so the response flows through
 * the standard envelope rather than Nest's default ThrottlerException body.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = typeof req['ip'] === 'string' ? (req['ip'] as string) : undefined;
    const socket = req['socket'] as { remoteAddress?: string } | undefined;
    return Promise.resolve(ip ?? socket?.remoteAddress ?? 'unknown');
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<HttpResponseLike>();
    const retryAfter = Math.max(1, Math.ceil(detail.timeToExpire));
    res.setHeader('Retry-After', String(retryAfter));
    throw new DomainException(ERROR_CODES.RATE_LIMITED, undefined, {
      detail: { retry_after_seconds: retryAfter },
    });
  }
}
