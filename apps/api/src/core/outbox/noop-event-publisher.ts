import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { EventPublisherPort, OutboxMessage } from './event-publisher.port';

/**
 * Default {@link EventPublisherPort} for development and test (and any
 * environment where real Pub/Sub publishing is not enabled). It performs no
 * network call — it records, at debug level, that an event would have been
 * published — so the outbox machinery (poll → publish → mark) runs end-to-end
 * without a live broker. Real publishing is wired by {@link PubSubEventPublisher}
 * only when configuration enables it (see OutboxModule).
 *
 * It logs only non-PII envelope identifiers (event_id / event_code /
 * aggregate_type) — never the payload, which may carry masked-but-sensitive data.
 */
@Injectable()
export class NoopEventPublisher implements EventPublisherPort {
  constructor(@Inject(PinoLogger) private readonly logger: PinoLogger) {
    this.logger.setContext(NoopEventPublisher.name);
  }

  async publish(message: OutboxMessage): Promise<void> {
    this.logger.debug(
      {
        event_id: message.eventId,
        event_code: message.attributes.event_code,
        aggregate_type: message.attributes.aggregate_type,
      },
      'outbox publish skipped (no-op publisher; real Pub/Sub disabled)',
    );
  }
}
