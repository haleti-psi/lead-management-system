import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  NOTIFICATION_CHANNEL_PORT,
  type NotificationChannelPort,
} from '../../../core/integration';
import { CommunicationRepository } from '../communication.repository';
import { TemplateRepository } from '../template.repository';

export interface DispatchCommunicationTask {
  communication_log_id: string;
}

/** System actor id for worker writes. */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * FR-101 — Cloud Tasks worker that performs the actual provider send.
 *
 * Idempotency: if the log row is already 'sent' or 'delivered', skip (no-op).
 * If it is 'failed' and not in a terminal retry state, re-attempt.
 * Provider errors do NOT throw — they update the log to 'failed' so Cloud Tasks
 * can retry via exp backoff up to the configured max; after that the row stays
 * 'failed' (the DLQ handler performs operational alerting).
 */
@Injectable()
export class DispatchCommunicationWorker {
  constructor(
    private readonly commRepo: CommunicationRepository,
    private readonly templateRepo: TemplateRepository,
    @Inject(NOTIFICATION_CHANNEL_PORT)
    private readonly channelPort: NotificationChannelPort,
    @InjectPinoLogger(DispatchCommunicationWorker.name)
    private readonly logger: PinoLogger,
  ) {}

  async run(task: DispatchCommunicationTask): Promise<void> {
    const { communication_log_id } = task;

    // Idempotency: fetch the log row.
    const log = await this.commRepo.findById(communication_log_id);
    if (log == null) {
      this.logger.warn({ communication_log_id }, 'DispatchCommunicationWorker: log row not found');
      return;
    }

    // Skip terminal states (already sent/delivered/failed-final).
    if (log.status === 'sent' || log.status === 'delivered') {
      this.logger.debug(
        { communication_log_id, status: log.status },
        'DispatchCommunicationWorker: already dispatched, skipping',
      );
      return;
    }

    // Fetch the template for template code (required by port).
    const templateCode = log.template_id != null
      ? (await this.templateRepo.findById(log.template_id))?.code ?? 'unknown'
      : 'unknown';

    try {
      await this.channelPort.send({
        channel: log.channel,
        templateCode,
        recipient: log.recipient,
        variables: {},
      });

      await this.commRepo.updateStatus(communication_log_id, {
        status: 'sent',
        sent_at: new Date(),
        updated_by: SYSTEM_USER_ID,
      });

      this.logger.info({ communication_log_id }, 'DispatchCommunicationWorker: sent');
    } catch (err: unknown) {
      // Mark as failed; Cloud Tasks will retry (no throw here).
      const reason = err instanceof Error ? err.message : 'unknown provider error';
      const safeMsg = reason.slice(0, 200);
      this.logger.warn(
        { communication_log_id, provider_error: safeMsg },
        'DispatchCommunicationWorker: provider error',
      );

      await this.commRepo.updateStatus(communication_log_id, {
        status: 'failed',
        failure_reason: reason,
        updated_by: SYSTEM_USER_ID,
      }).catch((updateErr: unknown) => {
        // Status update failure is non-fatal — log and swallow so Cloud Tasks retries.
        this.logger.error(
          { communication_log_id, updateErr },
          'DispatchCommunicationWorker: failed to update status after provider error',
        );
      });
    }
  }
}
