import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { IntegrationGateway } from './integration-gateway';
import { IntegrationLogRepository } from './integration-log.repository';
import { CloudTasksRetryQueueAdapter } from './adapters/cloud-tasks-retry-queue.adapter';
import { KycMockAdapter } from './adapters/kyc-mock.adapter';
import { LosMockAdapter } from './adapters/los-mock.adapter';
import { NoopRetryQueueAdapter } from './adapters/noop-retry-queue.adapter';
import { LosWebhookGuard } from './guards/los-webhook.guard';
import { KYC_PORT } from './ports/kyc.port';
import { LOS_PORT } from './ports/los.port';
import { MockChannelAdapter } from './ports/mock-channel.adapter';
import { NOTIFICATION_CHANNEL_PORT } from './ports/notification-channel.port';
import { RETRY_QUEUE_PORT } from './retry-queue.port';

/**
 * Core integration framework (FR-140) — the {@link IntegrationGateway} chokepoint
 * plus its circuit breaker, log repository, provider ports, and retry queue. It
 * is `@Global` so every feature module can inject `IntegrationGateway` and the
 * ports without re-importing (architecture §3: shared infra under `core/`).
 *
 * Adapter selection (no live external/GCP calls outside production):
 *   - `LOS_PORT` / `KYC_PORT`  → mock adapters. Per ADR-4 the system is built
 *     against the mock; the real HTTP adapters are the "swap last" item wired by
 *     the LOS/KYC FRs (FR-081/FR-082/FR-07x) once provider config lands. Until
 *     then the mock is the bound implementation in every environment.
 *   - `RETRY_QUEUE_PORT`       → Cloud Tasks in production, a no-op double in
 *     dev/test, so the test suite never reaches Cloud Tasks.
 *   - `NOTIFICATION_CHANNEL_PORT` (from FR-001) is re-exported here so consumers
 *     resolve it from the integration layer; M11 swaps the real channel adapters.
 */
@Global()
@Module({
  providers: [
    CircuitBreakerService,
    IntegrationLogRepository,
    IntegrationGateway,
    LosWebhookGuard,
    { provide: LOS_PORT, useClass: LosMockAdapter },
    { provide: KYC_PORT, useClass: KycMockAdapter },
    { provide: NOTIFICATION_CHANNEL_PORT, useClass: MockChannelAdapter },
    {
      provide: RETRY_QUEUE_PORT,
      useFactory: (
        config: AppConfigService,
        cloud: CloudTasksRetryQueueAdapter,
        noop: NoopRetryQueueAdapter,
      ) => (config.isProduction ? cloud : noop),
      inject: [AppConfigService, CloudTasksRetryQueueAdapter, NoopRetryQueueAdapter],
    },
    CloudTasksRetryQueueAdapter,
    NoopRetryQueueAdapter,
  ],
  exports: [
    IntegrationGateway,
    CircuitBreakerService,
    IntegrationLogRepository,
    LosWebhookGuard,
    LOS_PORT,
    KYC_PORT,
    NOTIFICATION_CHANNEL_PORT,
    RETRY_QUEUE_PORT,
  ],
})
export class IntegrationCoreModule {}
