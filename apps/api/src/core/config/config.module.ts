import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

/**
 * Global configuration module. Loads process env, validates it against the Zod
 * schema (architecture §6 / environment-contract.md) at startup — a missing or
 * invalid required var crashes the process immediately with a clear message —
 * and exposes the typed {@link AppConfigService} app-wide.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
