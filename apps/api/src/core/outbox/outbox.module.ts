import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config';
import { EVENT_PUBLISHER, type EventPublisherPort } from './event-publisher.port';
import { NoopEventPublisher } from './noop-event-publisher';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxService } from './outbox.service';
import { PubSubEventPublisher } from './pubsub-event-publisher';

/**
 * FR-141 — transactional outbox module (architecture §3 core/, ADR-7).
 *
 * Global so ANY state-changing FR can inject {@link OutboxService} (the pinned
 * `emit(event, tx)` writer) without importing this module. The background
 * {@link OutboxPublisherService} relay starts itself on application bootstrap.
 *
 * The {@link EVENT_PUBLISHER} binding selects the publish adapter from config:
 * real Pub/Sub in production, the {@link NoopEventPublisher} everywhere else —
 * so dev and test never need a live broker, and tests inject their own mock by
 * overriding this token. Both concrete adapters are provided so the factory can
 * resolve either without conditional providers.
 */
@Global()
@Module({
  providers: [
    OutboxService,
    OutboxPublisherService,
    NoopEventPublisher,
    PubSubEventPublisher,
    {
      provide: EVENT_PUBLISHER,
      inject: [AppConfigService, NoopEventPublisher, PubSubEventPublisher],
      useFactory: (
        config: AppConfigService,
        noop: NoopEventPublisher,
        pubsub: PubSubEventPublisher,
      ): EventPublisherPort => (config.isProduction ? pubsub : noop),
    },
  ],
  exports: [OutboxService, OutboxPublisherService],
})
export class OutboxModule {}
