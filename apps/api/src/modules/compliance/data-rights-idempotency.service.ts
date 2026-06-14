import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS } from '../../core/redis';
import {
  DATA_RIGHTS_IDEMPOTENCY_TTL_SECONDS,
  IDEMPOTENCY_SCOPE_CREATE_DATA_RIGHTS,
} from './data-rights.constants';

/**
 * FR-112 — Redis idempotency cache for POST /data-rights (mirrors GrievanceIdempotencyService).
 * Key shape `idempotency:create_data_rights:<Idempotency-Key>`.
 * Cached value is the response `data` payload; replayed with HTTP 200 (IDEMPOTENT_REPLAY).
 * 24 h TTL.
 */
@Injectable()
export class DataRightsIdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | undefined> {
    const cached = await this.redis.get(this.cacheKey(key));
    if (cached == null) return undefined;
    return JSON.parse(cached) as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.redis.set(
      this.cacheKey(key),
      JSON.stringify(value),
      'EX',
      DATA_RIGHTS_IDEMPOTENCY_TTL_SECONDS,
    );
  }

  private cacheKey(key: string): string {
    return `idempotency:${IDEMPOTENCY_SCOPE_CREATE_DATA_RIGHTS}:${key}`;
  }
}
