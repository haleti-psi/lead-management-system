import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';

import { AppConfigModule } from './core/config';
import { DbModule } from './core/db';
import { AllExceptionsFilter, CorrelationMiddleware, ResponseEnvelopeInterceptor } from './core/http';
import { LoggingModule } from './core/logging';
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
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
