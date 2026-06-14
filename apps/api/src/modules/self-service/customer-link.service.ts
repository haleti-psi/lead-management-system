import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  type CommChannel,
  ERROR_CODES,
  EventCode,
  type RoleCode,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { AppConfigService } from '../../core/config';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import {
  NOTIFICATION_CHANNEL_PORT,
  type NotificationChannelPort,
} from '../../core/integration';
import { OutboxService } from '../../core/outbox';
import { leadInScope } from '../kyc/document.service';
import { SYSTEM_USER_ID } from '../identity/identity.constants';
import { CustomerLinkRepository, type CustomerLinkRow } from './customer-link.repository';
import { OtpService } from './otp.service';
import { CUSTOMER_LINK_RESOURCE_TYPE, DEFAULT_LINK_TTL_DAYS, type LinkPurpose } from './self-service.constants';
import { generateRawToken, hashToken } from './token.util';
import type { CreateCustomerLinkDto } from './dto/create-customer-link.dto';

/** Caller context the controller passes alongside the validated body. */
export interface CustomerLinkActorContext {
  userId: string;
  orgId: string;
  role: RoleCode;
  predicate: ScopePredicate | undefined;
}

/** `POST /leads/{id}/customer-link` response (LLD §1). Token is NEVER returned. */
export interface CreateCustomerLinkData {
  customer_link_id: string;
  lead_id: string;
  status: string;
  expires_at: Date;
  purpose: LinkPurpose[];
  channel_dispatched: CommChannel;
}

/** `GET /c/{token}` landing response (LLD §2). No PII beyond the lead summary. */
export interface CustomerOpenData {
  customer_link_id: string;
  lead_id: string;
  purpose: string[];
  otp_required: boolean;
  otp_verified: boolean;
  lead_display: { product_display_name: string; status_label: string };
}

/** Customer-friendly stage labels (no internal stage names leaked). */
const STAGE_LABELS: Readonly<Record<string, string>> = {
  documents_pending: 'Documents Pending',
  kyc_in_progress: 'KYC In Progress',
  eligibility_requested: 'Under Review',
  ready_for_handoff: 'Under Review',
  handed_off: 'In Processing',
  contacted: 'In Progress',
  qualified: 'In Progress',
};

const DAY_MS = 86_400_000;

/**
 * FR-060 — customer self-service link (M7; sole writer of `customer_links`).
 * Creates/resends a tokenised, expiring, revocable link: revokes any prior active
 * link, inserts the new one (hash only), audits, emits `DOC_REQUEST`, then
 * post-commit generates the OTP and dispatches the URL via the notification
 * channel port. The raw token lives only in the dispatched URL.
 */
@Injectable()
export class CustomerLinkService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: CustomerLinkRepository,
    private readonly otp: OtpService,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(NOTIFICATION_CHANNEL_PORT) private readonly notifier: NotificationChannelPort,
    @InjectPinoLogger(CustomerLinkService.name) private readonly logger: PinoLogger,
  ) {}

  async create(
    leadId: string,
    dto: CreateCustomerLinkDto,
    ctx: CustomerLinkActorContext,
  ): Promise<CreateCustomerLinkData> {
    const lead = await this.repo.getLeadForLink(leadId, ctx.orgId);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (!leadInScope(lead, ctx.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const customerLinkId = randomUUID();
    const ttlDays = dto.expires_in_days ?? this.config.get('CUSTOMER_LINK_TTL_DAYS') ?? DEFAULT_LINK_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
    const purpose = dto.purpose;

    const link = await this.uow.run(async (tx) => {
      await this.repo.revokeActiveForLead(leadId, ctx.orgId, ctx.userId, tx);
      const row = await this.repo.insert(
        {
          customer_link_id: customerLinkId,
          org_id: ctx.orgId,
          lead_id: leadId,
          token_hash: tokenHash,
          purpose,
          expires_at: expiresAt,
          actor_id: ctx.userId,
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.LINK_CREATE,
          entity_type: CUSTOMER_LINK_RESOURCE_TYPE,
          entity_id: customerLinkId,
          actor_id: ctx.userId,
          org_id: ctx.orgId,
          lead_id: leadId,
          detail: { purpose, channel: dto.channel, expires_at: expiresAt.toISOString() },
        },
        tx,
      );

      await this.outbox.emit(
        {
          // AMB-2: no CUSTOMER_LINK_* event code; DOC_REQUEST is the closest.
          event_code: EventCode.DOC_REQUEST,
          aggregate_type: 'customer_links',
          aggregate_id: customerLinkId,
          payload: { lead_id: leadId, purpose, channel: dto.channel },
        },
        tx,
      );

      return row;
    });

    // Post-commit (non-blocking): generate the OTP + dispatch the URL. A
    // dispatch failure does NOT roll back the link (resend re-dispatches).
    try {
      const otp = await this.otp.generateAndStore(customerLinkId);
      const url = `${this.config.get('APP_BASE_URL')}/c/${rawToken}`;
      await this.notifier.send({
        channel: dto.channel,
        templateCode: 'customer_link_send',
        recipient: lead.mobile,
        variables: { url, otp, expires_at: expiresAt.toISOString() },
      });
    } catch {
      // Never log the recipient or token; record the failure only.
      this.logger.warn({ customer_link_id: customerLinkId }, 'customer link dispatch failed (link created; retry send)');
    }

    return {
      customer_link_id: customerLinkId,
      lead_id: leadId,
      status: link.status,
      expires_at: expiresAt,
      purpose,
      channel_dispatched: dto.channel,
    };
  }

  /**
   * `GET /c/{token}` — landing (LLD §2). The guard already validated the token
   * and attached the row. Records first open (idempotent) + a best-effort audit,
   * and returns the purpose + OTP state + a customer-safe lead summary.
   */
  async open(link: CustomerLinkRow): Promise<CustomerOpenData> {
    // Record the first open only (idempotent) — no audit noise on repeat visits.
    if (!link.opened_at) {
      await this.repo.markOpened(link.customer_link_id);
      await this.audit.append({
        action: AuditAction.LINK_OPEN,
        entity_type: CUSTOMER_LINK_RESOURCE_TYPE,
        entity_id: link.customer_link_id,
        actor_id: SYSTEM_USER_ID,
        org_id: link.org_id,
        lead_id: link.lead_id,
        detail: null,
      });
    }

    const display = await this.repo.getLeadDisplay(link.lead_id, link.org_id);
    const otpVerified = await this.otp.hasValidSession(link.customer_link_id);

    return {
      customer_link_id: link.customer_link_id,
      lead_id: link.lead_id,
      purpose: Array.isArray(link.purpose) ? (link.purpose as string[]) : [],
      otp_required: true,
      otp_verified: otpVerified,
      lead_display: {
        product_display_name: display?.product_code ?? 'Loan Application',
        status_label: display ? (STAGE_LABELS[display.stage] ?? 'In Progress') : 'In Progress',
      },
    };
  }

  /** Stamp the durable `otp_verified_at` after a successful OTP step-up (the Redis
   * session remains the live gate; this is the persistent record — LLD §3). */
  async markVerified(customerLinkId: string): Promise<void> {
    await this.repo.markOtpVerified(customerLinkId);
  }
}
