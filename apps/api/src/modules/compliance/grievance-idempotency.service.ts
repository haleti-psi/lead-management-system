import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS } from '../../core/redis';
import { IDEMPOTENCY_SCOPE_CREATE_GRIEVANCE, IDEMPOTENCY_TTL_SECONDS } from './grievance.constants';

/**
 * FR-114 — Redis idempotency cache for POST /grievances (mirrors CaptureIdempotencyService).
 * Key shape `idempotency:<scope>:<Idempotency-Key>`; the cached value is the
 * response `data` payload, replayed verbatim with HTTP 200 so a client retry
 * never creates a duplicate grievance row. 24 h TTL. Replay is transparent:
 * `error` stays null (error-taxonomy.md sub-reason IDEMPOTENT_REPLAY).
 */
@Injectable()
export class GrievanceIdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | undefined> {
    const cached = await this.redis.get(this.cacheKey(key));
    if (cached == null) {
      return undefined;
    }
    return JSON.parse(cached) as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.redis.set(
      this.cacheKey(key),
      JSON.stringify(value),
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
    );
  }

  private cacheKey(key: string): string {
    return `idempotency:${IDEMPOTENCY_SCOPE_CREATE_GRIEVANCE}:${key}`;
  }
}
