import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { REDIS } from '../redis';

/**
 * Redis-backed {@link ThrottlerStorage} (security.md: rate limiting is
 * Memorystore-backed so the window is shared across Cloud Run instances). Uses a
 * single atomic Lua script per hit — INCR, set the TTL on first hit, and read
 * the remaining TTL — so concurrent requests cannot race the window. Built on
 * the approved `ioredis` client; no extra storage-bridge dependency.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  // KEYS[1]=hit key, KEYS[2]=block key; ARGV[1]=ttl(ms), ARGV[2]=limit, ARGV[3]=blockDuration(ms).
  // Returns { totalHits, timeToExpireMs, isBlocked(0/1), timeToBlockExpireMs }.
  private static readonly SCRIPT = `
    local blockTtl = redis.call('PTTL', KEYS[2])
    if blockTtl > 0 then
      return { tonumber(redis.call('GET', KEYS[2])) or ARGV[2], redis.call('PTTL', KEYS[1]), 1, blockTtl }
    end
    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('PTTL', KEYS[1])
    if hits > tonumber(ARGV[2]) then
      redis.call('SET', KEYS[2], hits, 'PX', ARGV[3])
      return { hits, ttl, 1, tonumber(ARGV[3]) }
    end
    return { hits, ttl, 0, 0 }
  `;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle-block:${throttlerName}:${key}`;
    const result = (await this.redis.eval(
      RedisThrottlerStorage.SCRIPT,
      2,
      hitKey,
      blockKey,
      String(ttl),
      String(limit),
      String(blockDuration),
    )) as [number, number, number, number];

    const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = result;
    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpireMs / 1000),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
    };
  }
}
