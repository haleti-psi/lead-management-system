import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { DomainException } from '../http/domain-exception';
import type { HttpResponseLike } from '../http/http-types';
import { AppThrottlerGuard } from './app-throttler.guard';

/** Subclass exposing the protected hooks under test. */
class TestableGuard extends AppThrottlerGuard {
  publicTracker(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
  publicThrow(ctx: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    return this.throwThrottlingException(ctx, detail);
  }
}

function makeGuard(): TestableGuard {
  const options: ThrottlerModuleOptions = { throttlers: [{ limit: 10, ttl: 60_000 }] };
  const storage = { increment: jest.fn() } as unknown as ThrottlerStorage;
  return new TestableGuard(options, storage, new Reflector());
}

function detail(timeToExpire: number): ThrottlerLimitDetail {
  return {
    totalHits: 11,
    timeToExpire,
    isBlocked: true,
    timeToBlockExpire: timeToExpire,
    ttl: 60_000,
    limit: 10,
    key: 'k',
    tracker: '1.2.3.4',
  };
}

describe('AppThrottlerGuard', () => {
  it('tracks by request IP', async () => {
    const guard = makeGuard();
    expect(await guard.publicTracker({ ip: '203.0.113.9' })).toBe('203.0.113.9');
  });

  it('falls back to socket.remoteAddress, then "unknown"', async () => {
    const guard = makeGuard();
    expect(await guard.publicTracker({ socket: { remoteAddress: '10.0.0.2' } })).toBe('10.0.0.2');
    expect(await guard.publicTracker({})).toBe('unknown');
  });

  // T-012 / T-013 / T-014 — every auth endpoint surfaces the same RATE_LIMITED mapping.
  it('throws RATE_LIMITED (429) with a Retry-After header on limit breach', async () => {
    const guard = makeGuard();
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      getHeader: () => undefined,
      status: () => res,
      json: () => res,
    } as unknown as HttpResponseLike;
    const ctx = {
      switchToHttp: () => ({ getResponse: <T>(): T => res as T }),
    } as unknown as ExecutionContext;

    const err = await guard.publicThrow(ctx, detail(42)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException);
    const de = err as DomainException;
    expect(de.code).toBe('RATE_LIMITED');
    expect(de.httpStatus).toBe(429);
    expect(de.detail).toMatchObject({ retry_after_seconds: 42 });
    expect(headers['Retry-After']).toBe('42');
  });
});
