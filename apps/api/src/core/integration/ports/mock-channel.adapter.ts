import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import type { NotificationChannelPort, NotificationSend } from './notification-channel.port';

/**
 * Default {@link NotificationChannelPort} for non-production builds and the test
 * double referenced in the integration map (`MockChannelAdapter`). It records
 * nothing sensitive — it logs only the channel and template (never the recipient
 * or variables, which may contain PII / a reset URL). The real provider adapters
 * are wired by M11 in production.
 */
@Injectable()
export class MockChannelAdapter implements NotificationChannelPort {
  constructor(private readonly logger: Logger) {}

  async send(message: NotificationSend): Promise<void> {
    this.logger.debug(
      { channel: message.channel, template_code: message.templateCode },
      'MockChannelAdapter dispatch',
    );
    await Promise.resolve();
  }
}
