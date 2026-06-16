import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';

import { AuditModule } from './core/audit';
import {
  AbacGuard,
  AppThrottlerGuard,
  AuthCoreModule,
  JwtAuthGuard,
  RedisThrottlerStorage,
} from './core/auth';
import { AppConfigModule, AppConfigService } from './core/config';
import { DbModule } from './core/db';
import { AllExceptionsFilter, CorrelationMiddleware, ResponseEnvelopeInterceptor } from './core/http';
import { IntegrationCoreModule } from './core/integration/integration-core.module';
import { LoggingModule } from './core/logging';
import { MaskingInterceptor, MaskingModule } from './core/masking';
import { OutboxModule } from './core/outbox';
import { RedisModule } from './core/redis';
import { SlaModule } from './core/sla';
import { AdminModule } from './modules/admin/admin.module';
import { AllocationModule } from './modules/allocation/allocation.module';
import { CaptureModule } from './modules/capture/capture.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { DedupeModule } from './modules/dedupe/dedupe.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { KycModule } from './modules/kyc/kyc.module';
import { ProductConfigModule } from './modules/product-config/product-config.module';
import { PartnerModule } from './modules/partner/partner.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { SelfServiceModule } from './modules/self-service/self-service.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { LosModule } from './modules/los/los.module';
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
    LoggingModule.forRoot(),
    DbModule,
    RedisModule,
    AuditModule,
    AuthCoreModule,
    MaskingModule,
    OutboxModule,
    // FR-140 — integration framework. @Global IntegrationGateway + ports/circuit
    // breaker/retry queue, imported once here so every feature module injects them
    // without re-importing (architecture §3: shared infra under core/).
    IntegrationCoreModule,
    // FR-104 — business-time clock + SLA engine (ADR-6). Global; engagement binds
    // the policy-reader port, M2/KYC/M12 bind the writer ports later.
    SlaModule,
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
    // FR-010 (M2 capture). @Global: owns LeadService (sole writer of `leads`)
    // and binds the cross-module lead-writer seams (LEAD_SLA_WRITER_PORT for the
    // global SlaEngine; LeadReassignmentAdapter consumed by AdminModule).
    // Registered before AdminModule, whose LEAD_REASSIGN_PORT now resolves to it.
    CaptureModule,
    // FR-030 (M4 allocation). @Global: binds capture's ALLOCATION_PORT so lead
    // creation triggers rules-based allocation inside the creating transaction;
    // owns allocation_rules (its slug is excluded from FR-131's generic
    // /admin/{masterResource} allow-list — no route collision).
    AllocationModule,
    // FR-020 (M3 dedupe). @Global: binds capture's DUPLICATE_CHECK_PORT to the
    // real DuplicateCheckAdapter (replacing the Wave-2 noop), so lead creation
    // runs the sync strong-block gate inside the capture transaction and the
    // post-commit scan persists medium/weak flags.
    DedupeModule,
    // FR-110 (M12 compliance). Owns the append-only `consent_records` ledger +
    // the leads.consent_status derivation (via the @Global CaptureModule's
    // LeadService.setConsentStatus). `/c/{token}/consent` is live behind the
    // FR-060 CustomerLinkPort seam.
    ComplianceModule,
    // FR-060 (M7 self-service). @Global — owns `customer_links` + the token/OTP
    // machinery and REBINDS the CUSTOMER_LINK_PORT seam to the real adapter, so
    // the FR-070 /c/{token}/documents and FR-110 /c/{token}/consent endpoints
    // resolve live tokens. Registered before KycModule for clarity (the @Global
    // port is visible regardless of order).
    SelfServiceModule,
    // FR-070 (M8 KYC & Documents). Owns the `documents` table + the document
    // checklist/upload/waiver flow and the leads.kyc_status derivation (via the
    // @Global CaptureModule's LeadService.setKycStatus). `/c/{token}/documents`
    // is live behind the FR-060 CustomerLinkPort seam (reused from ComplianceModule).
    KycModule,
    EngagementModule,
    // FR-040 (M5 product configuration). Owns the `product_config` activator,
    // which self-registers with the shared FR-132 ConfigActivatorRegistry.
    ProductConfigModule,
    // FR-132 (M14 config governance), FR-140 (M15 integration admin surface),
    // FR-123 (M13 audit explorer). Each depends only on the global core modules
    // registered above (owner-writes §11; cross-module access via services).
    AdminModule,
    IntegrationModule,
    ReportingModule,
    // FR-050 (M6 workspace). Read-only lead list + saved views + the bulk-action
    // gate; `leads` mutations delegate to the @Global CaptureModule's LeadService.
    WorkspaceModule,
    // FR-080 (M9 LOS). LOS eligibility request + read-only snapshot. Depends on
    // the global IntegrationCoreModule (LOS_PORT, IntegrationGateway) and the
    // @Global CaptureModule (LeadService). Imports ComplianceModule for
    // DataSharingService.logShare (FR-111 seam).
    LosModule,
    // FR-090 (M10 partner). Partner master CRUD; sole writer of `partners`.
    PartnerModule,
  ],
  controllers: [HealthController],
  providers: [
    // Interceptor order: on the response, Nest runs the LAST-registered interceptor
    // first. MaskingInterceptor (FR-002) is registered after the envelope interceptor
    // so it masks the raw handler payload before ResponseEnvelopeInterceptor wraps it
    // in { data, meta, error }. Masking only acts when AbacGuard set a masking level.
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MaskingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order: throttle (per-IP, before auth) → JWT authn (FR-001) → ABAC (FR-002).
    // Public routes opt out of JWT via @Public(); throttle still applies. AbacGuard
    // enforces only where @Requires is present, and runs after the user is bound.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AbacGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
