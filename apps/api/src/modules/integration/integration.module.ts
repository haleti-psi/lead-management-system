import { Module } from '@nestjs/common';

import { IntegrationController } from './integration.controller';
import { IntegrationRepository } from './integration.repository';
import { IntegrationService } from './integration.service';

/**
 * M15 Integration & Events — FR-140 admin surface: the integration monitor and
 * webhook subscription management (`/api/v1/admin/integrations`,
 * `/api/v1/admin/webhooks`).
 *
 * The IntegrationGateway, circuit breaker, provider ports, retry queue, and the
 * inbound-webhook HMAC guard live in the GLOBAL `IntegrationCoreModule` (core
 * infrastructure), so this feature module only wires the HTTP-facing read/admin
 * pieces. It depends on the global core modules (DB, Redis, audit, auth-core,
 * config, logging); the orchestrator imports this module in `app.module`.
 */
@Module({
  controllers: [IntegrationController],
  providers: [IntegrationService, IntegrationRepository],
  exports: [IntegrationService],
})
export class IntegrationModule {}
