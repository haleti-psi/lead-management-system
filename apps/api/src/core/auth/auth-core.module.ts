import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AppConfigModule } from '../config';
import { RedisModule } from '../redis';
import { AppThrottlerGuard } from './app-throttler.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { TokenService } from './token.service';

/**
 * Core authentication module (architecture §5). Provides the JWT machinery
 * shared across the app: {@link TokenService} (sign/verify), the global
 * {@link JwtAuthGuard}, the Redis-backed throttler storage, and the
 * {@link AppThrottlerGuard}. The guards are registered as `APP_GUARD`s in
 * AppModule (so the order is fixed); this module owns their providers.
 *
 * `JwtModule` is registered with no global secret — every sign/verify call in
 * {@link TokenService} passes its own purpose-specific secret explicitly.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), AppConfigModule, RedisModule],
  providers: [TokenService, JwtAuthGuard, AppThrottlerGuard, RedisThrottlerStorage],
  exports: [TokenService, JwtAuthGuard, AppThrottlerGuard, RedisThrottlerStorage],
})
export class AuthCoreModule {}
