import type Redis from 'ioredis';

import type { AppConfigService } from '../../core/config';
import type { AppEnv } from '../../core/config/env.schema';
import { AuthSessionStore } from './auth-session.store';

/** A minimal in-memory ioredis stub recording calls and key/TTL state. */
class RedisStub {
  store = new Map<string, string>();
  ttls = new Map<string, number>();
  calls: Array<{ cmd: string; args: unknown[] }> = [];

  incr = jest.fn(async (key: string): Promise<number> => {
    this.calls.push({ cmd: 'incr', args: [key] });
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  });
  expire = jest.fn(async (key: string, ttl: number): Promise<number> => {
    this.calls.push({ cmd: 'expire', args: [key, ttl] });
    this.ttls.set(key, ttl);
    return 1;
  });
  del = jest.fn(async (key: string): Promise<number> => {
    this.calls.push({ cmd: 'del', args: [key] });
    return this.store.delete(key) ? 1 : 0;
  });
  set = jest.fn(async (key: string, value: string, _ex: string, ttl: number): Promise<'OK'> => {
    this.calls.push({ cmd: 'set', args: [key, value, _ex, ttl] });
    this.store.set(key, value);
    this.ttls.set(key, ttl);
    return 'OK';
  });
  get = jest.fn(async (key: string): Promise<string | null> => this.store.get(key) ?? null);
  exists = jest.fn(async (key: string): Promise<number> => (this.store.has(key) ? 1 : 0));
  ttl = jest.fn(async (key: string): Promise<number> => this.ttls.get(key) ?? -2);

  asRedis(): Redis {
    return this as unknown as Redis;
  }
}

function makeConfig(): AppConfigService {
  const values: Partial<AppEnv> = {
    LOCKOUT_THRESHOLD: 5,
    LOCKOUT_MINUTES: 15,
    OTP_TTL_SECONDS: 300,
    REFRESH_TOKEN_TTL: '7d',
  };
  return {
    get: <K extends keyof AppEnv>(key: K): AppEnv[K] => values[key] as AppEnv[K],
    isProduction: false,
  } as AppConfigService;
}

describe('AuthSessionStore', () => {
  let redis: RedisStub;
  let store: AuthSessionStore;

  beforeEach(() => {
    redis = new RedisStub();
    store = new AuthSessionStore(redis.asRedis(), makeConfig());
  });

  it('increments the fail counter under fail:<userId> and (re)sets the 15-min window', async () => {
    const count = await store.incrementFailCount('u1');
    expect(count).toBe(1);
    expect(redis.incr).toHaveBeenCalledWith('fail:u1');
    expect(redis.expire).toHaveBeenCalledWith('fail:u1', 900);
  });

  it('clears the fail counter', async () => {
    await store.clearFailCount('u1');
    expect(redis.del).toHaveBeenCalledWith('fail:u1');
  });

  it('reports the lockout threshold from config', () => {
    expect(store.isAtLockoutThreshold(4)).toBe(false);
    expect(store.isAtLockoutThreshold(5)).toBe(true);
  });

  it('sets the lockout flag under lockout:<userId> with the lockout TTL and reads it back', async () => {
    await store.setLockout('u1');
    expect(redis.set).toHaveBeenCalledWith('lockout:u1', '1', 'EX', 900);
    expect(await store.getLockoutTtl('u1')).toBe(900);
  });

  it('returns 0 lockout TTL when not locked', async () => {
    expect(await store.getLockoutTtl('absent')).toBe(0);
  });

  it('manages the single-use MFA challenge marker under mfa:challenge:<userId>', async () => {
    await store.setMfaChallenge('u1');
    expect(redis.set).toHaveBeenCalledWith('mfa:challenge:u1', '1', 'EX', 300);
    expect(await store.hasMfaChallenge('u1')).toBe(true);
    await store.clearMfaChallenge('u1');
    expect(redis.del).toHaveBeenCalledWith('mfa:challenge:u1');
  });

  it('stores and resolves a refresh token under refresh:<token> with the refresh TTL', async () => {
    await store.storeRefreshToken('tok', 'u1');
    expect(redis.set).toHaveBeenCalledWith('refresh:tok', 'u1', 'EX', 604_800);
    expect(await store.getRefreshUser('tok')).toBe('u1');
    await store.deleteRefreshToken('tok');
    expect(redis.del).toHaveBeenCalledWith('refresh:tok');
  });

  it('sets a password-reset marker under pw_reset:<userId>', async () => {
    await store.setPasswordReset('u1', 10_800);
    expect(redis.set).toHaveBeenCalledWith('pw_reset:u1', '1', 'EX', 10_800);
  });
});
