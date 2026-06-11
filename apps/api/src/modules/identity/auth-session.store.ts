import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfigService } from '../../core/config';
import { parseDurationSeconds } from '../../core/auth/token.service';
import { REDIS } from '../../core/redis';

/**
 * All auth-flow Redis state (LLD §Backend Flow): failed-login counters, the
 * account lockout flag, opaque refresh tokens, single-use MFA-challenge markers,
 * MFA-failure counters, and single-use password-reset markers. Keys and TTLs are
 * centralised here so the service stays free of raw Redis calls and is trivial
 * to fake in tests. No secret or PII is ever stored — only ids and counters.
 */
@Injectable()
export class AuthSessionStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  private get lockoutThreshold(): number {
    return this.config.get('LOCKOUT_THRESHOLD');
  }

  private get lockoutSeconds(): number {
    return this.config.get('LOCKOUT_MINUTES') * 60;
  }

  private get otpTtlSeconds(): number {
    return this.config.get('OTP_TTL_SECONDS');
  }

  private get refreshTtlSeconds(): number {
    return parseDurationSeconds(this.config.get('REFRESH_TOKEN_TTL'));
  }

  // ── Failed-login counter / lockout ────────────────────────────

  /** Increment the failed-login counter (15-min sliding window) and return the new count. */
  async incrementFailCount(userId: string): Promise<number> {
    const key = this.failKey(userId);
    const count = await this.redis.incr(key);
    // Reset the window on every failure (LLD step 5a: expiry resets on each increment).
    await this.redis.expire(key, this.lockoutSeconds);
    return count;
  }

  /** Clear the failed-login counter after a successful password verify (LLD step 6). */
  async clearFailCount(userId: string): Promise<void> {
    await this.redis.del(this.failKey(userId));
  }

  /** True once the failure count has reached the configured threshold. */
  isAtLockoutThreshold(count: number): boolean {
    return count >= this.lockoutThreshold;
  }

  /** Set the lockout flag with the configured TTL. */
  async setLockout(userId: string): Promise<void> {
    await this.redis.set(this.lockoutKey(userId), '1', 'EX', this.lockoutSeconds);
  }

  /** Remaining lockout seconds, or 0 if not locked (drives `retry_after_seconds`). */
  async getLockoutTtl(userId: string): Promise<number> {
    const ttl = await this.redis.ttl(this.lockoutKey(userId));
    return ttl > 0 ? ttl : 0;
  }

  /** Clear the lockout flag (admin unlock — referenced by FR-130). */
  async clearLockout(userId: string): Promise<void> {
    await this.redis.del(this.lockoutKey(userId));
  }

  // ── MFA challenge (single-use) + MFA failure counter ──────────

  async setMfaChallenge(userId: string): Promise<void> {
    await this.redis.set(this.mfaChallengeKey(userId), '1', 'EX', this.otpTtlSeconds);
  }

  async hasMfaChallenge(userId: string): Promise<boolean> {
    return (await this.redis.exists(this.mfaChallengeKey(userId))) === 1;
  }

  async clearMfaChallenge(userId: string): Promise<void> {
    await this.redis.del(this.mfaChallengeKey(userId));
  }

  async incrementMfaFailCount(userId: string): Promise<number> {
    const key = this.mfaFailKey(userId);
    const count = await this.redis.incr(key);
    await this.redis.expire(key, this.lockoutSeconds);
    return count;
  }

  async clearMfaFailCount(userId: string): Promise<void> {
    await this.redis.del(this.mfaFailKey(userId));
  }

  // ── Refresh tokens (opaque, rotating) ─────────────────────────

  /** Persist a refresh token → user_id mapping with the refresh TTL. */
  async storeRefreshToken(token: string, userId: string): Promise<void> {
    await this.redis.set(this.refreshKey(token), userId, 'EX', this.refreshTtlSeconds);
  }

  /** Resolve a refresh token to its user_id, or `null` if absent/expired/rotated. */
  async getRefreshUser(token: string): Promise<string | null> {
    return this.redis.get(this.refreshKey(token));
  }

  /** Invalidate a refresh token (rotation / idle-timeout / logout). */
  async deleteRefreshToken(token: string): Promise<void> {
    await this.redis.del(this.refreshKey(token));
  }

  // ── Password reset (single-use marker) ────────────────────────

  async setPasswordReset(userId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.pwResetKey(userId), '1', 'EX', ttlSeconds);
  }

  // ── Key builders ──────────────────────────────────────────────

  private failKey(userId: string): string {
    return `fail:${userId}`;
  }
  private lockoutKey(userId: string): string {
    return `lockout:${userId}`;
  }
  private mfaChallengeKey(userId: string): string {
    return `mfa:challenge:${userId}`;
  }
  private mfaFailKey(userId: string): string {
    return `mfa_fail:${userId}`;
  }
  private refreshKey(token: string): string {
    return `refresh:${token}`;
  }
  private pwResetKey(userId: string): string {
    return `pw_reset:${userId}`;
  }
}
