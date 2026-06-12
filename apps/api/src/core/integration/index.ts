// FR-140 — core integration framework public surface.
export { IntegrationCoreModule } from './integration-core.module';
export { IntegrationGateway, IdempotencyKeySchema } from './integration-gateway';
export type { GatewayOptions, GatewayResult } from './integration-gateway';
export { CircuitBreakerService } from './circuit-breaker.service';
export type { CircuitDecision } from './circuit-breaker.service';
export { IntegrationLogRepository } from './integration-log.repository';
export type {
  CreateLogParams,
  UpdateLogParams,
  IntegrationLogRow,
} from './integration-log.repository';
export { LosWebhookGuard } from './guards/los-webhook.guard';

// Ports + tokens (consumers depend on these, never on adapters).
export type { IntegrationPort, IntegrationRequest } from './ports/integration-port';
export {
  ProviderCallError,
  isSuccessStatus,
} from './ports/provider-response';
export type { ProviderResponse } from './ports/provider-response';
export type { LosPort } from './ports/los.port';
export { LOS_PORT } from './ports/los.port';
export type { KycPort } from './ports/kyc.port';
export { KYC_PORT } from './ports/kyc.port';
// FR-010 — public-capture captcha (shared-utilities.md; AMBIGUITIES C3).
export { CaptchaService } from './captcha.service';
export type { CaptchaPort } from './ports/captcha.port';
export { CAPTCHA_PORT } from './ports/captcha.port';
export type {
  NotificationChannelPort,
  NotificationSend,
} from './ports/notification-channel.port';
export { NOTIFICATION_CHANNEL_PORT } from './ports/notification-channel.port';
export {
  RETRY_QUEUE_PORT,
} from './retry-queue.port';
export type {
  RetryQueuePort,
  RetryTask,
  DeadLetterTask,
} from './retry-queue.port';

// Adapters (exported for explicit wiring/tests; consumers prefer the tokens).
export { LosMockAdapter } from './adapters/los-mock.adapter';
export { KycMockAdapter } from './adapters/kyc-mock.adapter';
export { CaptchaMockAdapter, CAPTCHA_MOCK_INVALID_TOKEN } from './adapters/captcha-mock.adapter';
export { NoopRetryQueueAdapter } from './adapters/noop-retry-queue.adapter';
export { CloudTasksRetryQueueAdapter } from './adapters/cloud-tasks-retry-queue.adapter';
