import { createHmac } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';

import type { AppConfigService } from '../../config';
import type { AppEnv } from '../../config/env.schema';
import { isDomainException } from '../../http/domain-exception';
import { fakePinoLogger } from '../integration.test-helpers';
import { LosWebhookGuard } from './los-webhook.guard';

/**
 * FR-140 unit tests for {@link LosWebhookGuard} (FR-140-tests.md T09, T10). The
 * guard recomputes HMAC-SHA256 over the raw body and compares constant-time to
 * the `x-los-signature` header. No network; the config secret is a fixed test
 * value.
 */

const SECRET = 'test-secret';

function makeConfig(secret: string | undefined): AppConfigService {
  return {
    get: <K extends keyof AppEnv>(key: K): AppEnv[K] =>
      (key === 'LOS_WEBHOOK_HMAC_SECRET' ? secret : undefined) as AppEnv[K],
    isProduction: false,
  } as AppConfigService;
}

function contextFor(rawBody: Buffer | undefined, signature: string | undefined): ExecutionContext {
  const headers: Record<string, string | undefined> = {};
  if (signature !== undefined) headers['x-los-signature'] = signature;
  const request = { headers, rawBody };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGuard(secret: string | undefined) {
  return new LosWebhookGuard(makeConfig(secret), fakePinoLogger() as never);
}

describe('LosWebhookGuard', () => {
  // T10 — a correct signature passes.
  it('accepts an inbound webhook with a correct HMAC signature', () => {
    const body = Buffer.from('{"foo":"bar"}');
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');
    const guard = makeGuard(SECRET);

    expect(guard.canActivate(contextFor(body, signature))).toBe(true);
  });

  // T09 — a wrong signature is rejected with FORBIDDEN.
  it('rejects an inbound webhook with a wrong HMAC signature (FORBIDDEN)', () => {
    const body = Buffer.from('{"foo":"bar"}');
    const wrong = createHmac('sha256', 'other-secret').update(body).digest('hex');
    const guard = makeGuard(SECRET);

    let thrown: unknown;
    try {
      guard.canActivate(contextFor(body, wrong));
    } catch (err) {
      thrown = err;
    }
    expect(isDomainException(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe('FORBIDDEN');
    expect((thrown as { httpStatus: number }).httpStatus).toBe(403);
  });

  // A tampered body (signature was for the original) is rejected.
  it('rejects when the body is tampered after signing', () => {
    const original = Buffer.from('{"amount":100}');
    const signature = createHmac('sha256', SECRET).update(original).digest('hex');
    const tampered = Buffer.from('{"amount":999}');
    const guard = makeGuard(SECRET);

    expect(() => guard.canActivate(contextFor(tampered, signature))).toThrow();
  });

  // A missing signature header is rejected.
  it('rejects when the signature header is missing', () => {
    const body = Buffer.from('{"foo":"bar"}');
    const guard = makeGuard(SECRET);
    expect(() => guard.canActivate(contextFor(body, undefined))).toThrow();
  });

  // A missing raw body is rejected (cannot verify).
  it('rejects when the raw body is unavailable', () => {
    const signature = createHmac('sha256', SECRET).update(Buffer.from('x')).digest('hex');
    const guard = makeGuard(SECRET);
    expect(() => guard.canActivate(contextFor(undefined, signature))).toThrow();
  });

  // An unconfigured secret is rejected (never process unverifiable webhooks).
  it('rejects when LOS_WEBHOOK_HMAC_SECRET is not configured', () => {
    const body = Buffer.from('{"foo":"bar"}');
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');
    const guard = makeGuard(undefined);
    expect(() => guard.canActivate(contextFor(body, signature))).toThrow();
  });
});
