import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfigService } from '../config';
import { REDIS } from './redis.constants';

/**
 * Global Redis (Memorystore) module. Provides one shared {@link Redis} client
 * built from `REDIS_URL` — used for rate-limiting, the auth lockout/refresh/MFA
 * keys, and idempotency. One connection per process; closed on shutdown so
 * Cloud Run instances drain cleanly.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (config: AppConfigService): Redis =>
        new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: 3, lazyConnect: false }),
      inject: [AppConfigService],
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // `quit` flushes pending commands then closes; ignore the resolved reply.
    await this.redis.quit();
  }
}
