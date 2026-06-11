import type { CommChannel } from '@lms/shared';

/** A single templated message dispatch (docs/contracts/integration-map.md). */
export interface NotificationSend {
  channel: CommChannel;
  /** Pre-approved template code — never free-form text (OD-17). */
  templateCode: string;
  /** Destination address (email/mobile). Never logged in clear. */
  recipient: string;
  /** Template variables (e.g. reset_url, expires_in). */
  variables: Record<string, string>;
}

/**
 * Outbound notification boundary (architecture §2; shared-utilities). Concrete
 * adapters (`EmailAdapter`/`SmsAdapter`/…) are owned by M11; FR-001 depends only
 * on this port to dispatch the password-reset email. The DI token is a symbol so
 * the adapter can be swapped per environment (`MockChannelAdapter` in tests).
 */
export interface NotificationChannelPort {
  send(message: NotificationSend): Promise<void>;
}

export const NOTIFICATION_CHANNEL_PORT = Symbol('NOTIFICATION_CHANNEL_PORT');
