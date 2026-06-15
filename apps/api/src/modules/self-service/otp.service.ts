import { Inject, Injectable } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../core/http';
import { REDIS } from '../../core/redis';
import {
  OTP_ATTEMPT_WINDOW_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  REDIS_KEYS,
  SESSION_TTL_SECONDS,
} from './self-service.constants';

/**
 * FR-060 — customer-link OTP step-up. A 6-digit OTP is generated at link send,
 * stored in Redis (TTL 10 min), and verified once; success opens a Redis session
 * (`clsession:{id}`) that gates the document/consent endpoints. Verification is
 * rate-limited per link and compared in constant time. This is distinct from the
 * staff TOTP MFA (FR-001) — a transient delivered code, not a shared secret.
 */
@Injectable()
export class OtpService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Generate + store a fresh OTP for a link; returns the code for dispatch only. */
  async generateAndStore(customerLinkId: string): Promise<string> {
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.set(REDIS_KEYS.otp(customerLinkId), otp, 'EX', OTP_TTL_SECONDS);
    return otp;
  }

  /**
   * Verify an OTP. Rate-limited (RATE_LIMITED 429 past the window cap); a wrong or
   * absent code is AUTH_REQUIRED (401). On success the OTP is consumed and a
   * session opened; returns the session expiry.
   */
  async verify(customerLinkId: string, otp: string): Promise<{ sessionExpiresAt: Date }> {
    const attemptsKey = REDIS_KEYS.otpAttempts(customerLinkId);
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.expire(attemptsKey, OTP_ATTEMPT_WINDOW_SECONDS);
    }
    if (attempts > OTP_MAX_ATTEMPTS) {
      throw new DomainException(ERROR_CODES.RATE_LIMITED, 'Too many OTP attempts. Please try again later.');
    }

    const stored = await this.redis.get(REDIS_KEYS.otp(customerLinkId));
    if (!stored || !constantTimeEquals(stored, otp)) {
      throw new DomainException(ERROR_CODES.AUTH_REQUIRED, 'OTP verification required.');
    }

    await this.redis.del(REDIS_KEYS.otp(customerLinkId));
    await this.redis.set(REDIS_KEYS.session(customerLinkId), '1', 'EX', SESSION_TTL_SECONDS);
    return { sessionExpiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) };
  }

  /** Whether a verified OTP session is currently valid for the link. */
  async hasValidSession(customerLinkId: string): Promise<boolean> {
    return (await this.redis.exists(REDIS_KEYS.session(customerLinkId))) === 1;
  }
}

/** Length-safe constant-time string compare. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
