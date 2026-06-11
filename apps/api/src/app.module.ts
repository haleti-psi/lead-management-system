import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';

import { AuditModule } from './core/audit';
import { AppThrottlerGuard, AuthCoreModule, JwtAuthGuard, RedisThrottlerStorage } from './core/auth';
import { AppConfigModule, AppConfigService } from './core/config';
import { DbModule } from './core/db';
import { AllExceptionsFilter, CorrelationMiddleware, ResponseEnvelopeInterceptor } from './core/http';
import { LoggingModule } from './core/logging';
import { RedisModule } from './core/redis';
import { IdentityModule } from './modules/identity/identity.module';
import { HealthController } from './health.controller';

// Root module. Stage-7 foundation wave (architecture §12): cross-cutting core/
// infra is registered here once for every module. FR-001 registers the global
// JwtAuthGuard here; FRs add their modules below (one Nest module per BRD module
// M1–M15 under src/modules/). Cross-module access stays through services
// (owner-writes §11) — never re-implement core/ utilities.
@Module({
  imports: [
    // ClsModule (global) backs the UnitOfWork ambient transaction (§11.1) and
    // auto-binds a CLS context per request.
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    AppConfigModule,
    LoggingModule,
    DbModule,
    RedisModule,
    AuditModule,
    AuthCoreModule,
    // Redis-backed throttler (security.md). Default tier = auth rate (10/min per
    // IP); endpoints needing other tiers override with @Throttle/@SkipThrottle.
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule, AuthCoreModule],
      inject: [AppConfigService, RedisThrottlerStorage],
      useFactory: (config: AppConfigService, storage: ThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: config.get('RATE_LIMIT_AUTH') }],
        storage,
      }),
    }),
    IdentityModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order: throttle (per-IP, before auth) → JWT authn. ABAC (FR-002) is
    // added later. Public routes opt out of JWT via @Public(); throttle still applies.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
