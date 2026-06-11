import { Injectable } from '@nestjs/common';
import { PubSub, type Topic } from '@google-cloud/pubsub';

import { AppConfigService } from '../config';
import type { EventPublisherPort, OutboxMessage } from './event-publisher.port';

/**
 * Production {@link EventPublisherPort}: relays outbox events to Google Cloud
 * Pub/Sub (`PUBSUB_TOPIC_EVENTS`). Used only when real publishing is enabled
 * (OutboxModule wires {@link NoopEventPublisher} otherwise). The topic and
 * project come from validated config — never hardcoded; Cloud Run's service
 * identity supplies credentials (the LLD requires `roles/pubsub.publisher`).
 *
 * The message is the FR-141 wire shape: JSON `data` plus string `attributes`
 * for subscriber filtering, with `orderingKey = event_id` so the broker carries
 * the dedup key. Any publish error propagates to the caller (the publisher
 * worker) for retry/markFailed; no error is swallowed here.
 */
@Injectable()
export class PubSubEventPublisher implements EventPublisherPort {
  private readonly client: PubSub;
  private readonly topicName: string;
  private topicHandle: Topic | undefined;

  constructor(config: AppConfigService) {
    this.client = new PubSub({ projectId: config.get('GCP_PROJECT') });
    this.topicName = config.get('PUBSUB_TOPIC_EVENTS');
  }

  async publish(message: OutboxMessage): Promise<void> {
    const topic = this.topic();
    await topic.publishMessage({
      data: Buffer.from(JSON.stringify(message.data), 'utf8'),
      attributes: { ...message.attributes },
      orderingKey: message.eventId,
    });
  }

  private topic(): Topic {
    if (this.topicHandle === undefined) {
      // messageOrdering must be on for orderingKey to be accepted by the client.
      this.topicHandle = this.client.topic(this.topicName, { messageOrdering: true });
    }
    return this.topicHandle;
  }
}
