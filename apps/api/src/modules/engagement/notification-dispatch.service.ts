import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditAction, CommCategory } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import {
  NOTIFICATION_CHANNEL_PORT,
  type NotificationChannelPort,
} from '../../core/integration';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { SendCommunicationDto } from './dto/send-communication.dto';
import { CommunicationRepository } from './communication.repository';
import type { CommLogRow } from './communication.repository';
import { TemplateRepository } from './template.repository';

export interface DispatchResult {
  communication_log_id: string;
  status: 'queued';
}

/**
 * FR-101 — NotificationDispatchService.
 *
 * Consent-gated send path:
 * 1. Verify lead exists (org-scoped read).
 * 2. Resolve the active template and validate channel consistency.
 * 3. Enforce marketing/consent_basis alignment.
 * 4. Check ConsentRecord (consent_records) for granted purpose.
 * 5. Check NotificationPreference for opt-out (absent = opted-in for transactional,
 *    opted-out for marketing per BRD default).
 * 6. INSERT communication_logs (queued) + audit in ONE UnitOfWork transaction.
 * 7. Dispatch async via NotificationChannelPort (post-tx in a real Cloud Tasks worker;
 *    here we fire-and-forget via the mock for synchronous tests — the log row is the
 *    source of truth, not the channel call).
 *
 * NOTE on FR-103 wire: notification_preferences is queried directly because FR-103
 * is not yet built. We treat absence as opted-in for transactional, opted-out for
 * marketing (per LLD default). This is noted in AMBIGUITY.md.
 */
@Injectable()
export class NotificationDispatchService {
  constructor(
    private readonly templateRepo: TemplateRepository,
    private readonly commRepo: CommunicationRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    @Inject(NOTIFICATION_CHANNEL_PORT)
    private readonly channelPort: NotificationChannelPort,
    @Inject(KYSELY) private readonly db: KyselyDb,
    @InjectPinoLogger(NotificationDispatchService.name)
    private readonly logger: PinoLogger,
  ) {}

  async send(
    leadId: string,
    dto: SendCommunicationDto,
    caller: AuthUser,
  ): Promise<DispatchResult> {
    const orgId = ORG_ID_DEFAULT;

    // ── Step 1: Verify lead exists (read-only, no tx needed). ─────────────────
    const lead = await this.db
      .selectFrom('leads')
      .select(['lead_id', 'org_id', 'owner_id', 'branch_id', 'team_id'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();

    if (lead == null) {
      throw new DomainException('NOT_FOUND', 'Lead not found.');
    }

    // ── Step 2: Fetch active template. ────────────────────────────────────────
    const template = await this.templateRepo.findActiveById(dto.template_id);
    if (template == null) {
      throw new DomainException('NOT_FOUND', 'Template not found or not active.');
    }

    // ── Step 3: Channel consistency. ──────────────────────────────────────────
    if (template.channel !== dto.channel) {
      throw new DomainException('VALIDATION_ERROR', 'Channel does not match the template channel.');
    }

    // ── Step 4: Category/consent_basis alignment for marketing. ───────────────
    if (
      template.category === CommCategory.MARKETING &&
      dto.consent_basis !== 'marketing'
    ) {
      throw new DomainException('FORBIDDEN', 'Marketing messages require consent_basis=marketing.', {
        detail: { reason: 'CONSENT_MISSING' },
      });
    }

    // ── Step 5a: ConsentRecord gate. ──────────────────────────────────────────
    const consentRecord = await this.db
      .selectFrom('consent_records')
      .select(['consent_id', 'state'])
      .where('lead_id', '=', leadId)
      .where('purpose', '=', dto.consent_basis)
      .where('state', '=', 'granted')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (consentRecord == null) {
      throw new DomainException('FORBIDDEN', 'Consent not granted for this purpose.', {
        detail: { reason: 'CONSENT_MISSING' },
      });
    }

    // ── Step 5b: NotificationPreference opt-out gate. ─────────────────────────
    // FR-103 not yet built — we query the table directly and treat absence as default.
    const preference = await this.db
      .selectFrom('notification_preferences')
      .select(['opted_in'])
      .where('org_id', '=', orgId)
      .where('subject_ref', '=', leadId)
      .where('channel', '=', dto.channel)
      .where('purpose', '=', dto.consent_basis)
      .limit(1)
      .executeTakeFirst();

    const isOptedOut = preference != null
      ? !preference.opted_in
      // Absent preference: transactional = opted-in, marketing = opted-out.
      : template.category === CommCategory.MARKETING;

    if (isOptedOut) {
      throw new DomainException('FORBIDDEN', 'Recipient has opted out of this channel/purpose.', {
        detail: { reason: 'CONSENT_MISSING' },
      });
    }

    // ── Step 6: Atomic write — INSERT comm log + audit intent. ────────────────
    let commLog: CommLogRow;
    commLog = await this.uow.run(async (tx) => {
      const row = await this.commRepo.insert(
        {
          lead_id: leadId,
          template_id: dto.template_id,
          channel: dto.channel,
          recipient: dto.recipient,
          consent_basis: dto.consent_basis,
          created_by: caller.userId,
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.COMM_SEND,
          entity_type: 'communication_logs',
          entity_id: row.communication_log_id,
          actor_id: caller.userId,
          org_id: orgId,
          lead_id: leadId,
          detail: {
            channel: dto.channel,
            template_id: dto.template_id,
            consent_basis: dto.consent_basis,
          },
        },
        tx,
      );

      return row;
    });

    // ── Step 7: Fire-and-forget async dispatch (post-commit). ─────────────────
    // In production this would enqueue a Cloud Tasks job; for MVP/test the mock
    // channel is called directly. If it fails, the log row status stays 'queued'
    // and the worker job handles retry. We swallow the error here intentionally
    // (the log row is the canonical record; dispatch is best-effort at this layer).
    void this.dispatchAsync(commLog.communication_log_id, template.code, dto);

    this.logger.info(
      { communication_log_id: commLog.communication_log_id, channel: dto.channel },
      'FR-101 communication queued',
    );

    return {
      communication_log_id: commLog.communication_log_id,
      status: 'queued',
    };
  }

  /**
   * Async dispatch — runs after the transaction commits. In production this is
   * the Cloud Tasks worker. In tests the MockChannelAdapter intercepts the call.
   * Errors here do NOT surface to the caller (202 already returned).
   */
  private async dispatchAsync(
    logId: string,
    templateCode: string,
    dto: SendCommunicationDto,
  ): Promise<void> {
    try {
      await this.channelPort.send({
        channel: dto.channel,
        templateCode,
        recipient: dto.recipient,
        variables: {},
      });
      await this.commRepo.updateStatus(logId, {
        status: 'sent',
        sent_at: new Date(),
        updated_by: 'system',
      });
    } catch (err: unknown) {
      // Log the failure; update log status; do NOT propagate (worker handles retry).
      const safeMsg =
        err instanceof Error ? err.message.slice(0, 200) : 'unknown provider error';
      this.logger.warn(
        { communication_log_id: logId, channel: dto.channel, provider_error: safeMsg },
        'FR-101 async dispatch failed — marking log as failed',
      );
      await this.commRepo.updateStatus(logId, {
        status: 'failed',
        failure_reason: err instanceof Error ? err.message : 'unknown provider error',
        updated_by: 'system',
      }).catch(() => {
        // If the status update also fails, at worst the row stays 'queued' for retry.
      });
    }
  }
}
