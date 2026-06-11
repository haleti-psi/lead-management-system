import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from './env.schema';

/**
 * Typed accessor over the validated environment. Wraps `@nestjs/config`'s
 * `ConfigService` so callers get `AppEnv`-typed keys instead of `string`.
 * The env is validated once at startup by `validateEnv` (see AppConfigModule),
 * so reads here are always present and correctly typed.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}
