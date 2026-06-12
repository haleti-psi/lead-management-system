import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS } from '../../core/redis';
import { IDEMPOTENCY_TTL_SECONDS } from './capture.constants';

/**
 * FR-010 — Redis idempotency cache for state-creating POSTs (LLD steps A/G).
 * Key shape `idempotency:<scope>:<Idempotency-Key>`; the cached value is the
 * (already masked) response `data` payload, replayed verbatim with HTTP 200 so a
 * client retry never creates a duplicate row. 24 h TTL. Replay is transparent:
 * `error` stays null (error-taxonomy.md sub-reason IDEMPOTENT_REPLAY).
 */
@Injectable()
export class CaptureIdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get<T>(scope: string, key: string): Promise<T | undefined> {
    const cached = await this.redis.get(this.key(scope, key));
    if (cached == null) {
      return undefined;
    }
    return JSON.parse(cached) as T;
  }

  async set(scope: string, key: string, value: unknown): Promise<void> {
    await this.redis.set(this.key(scope, key), JSON.stringify(value), 'EX', IDEMPOTENCY_TTL_SECONDS);
  }

  private key(scope: string, key: string): string {
    return `idempotency:${scope}:${key}`;
  }
}
