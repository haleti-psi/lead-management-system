import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditAction, ERROR_CODES, LeadStage } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { REDIS } from '../../core/redis';
import { SYSTEM_USER_ID } from '../identity/identity.constants';
import type { ResolvedCustomerLink } from '../compliance/ports/customer-link.port';
import { CALLBACK_BLOCKED_STAGES, CUSTOMER_STAGE_MAP } from './customer-stage-map';
import { StatusRepository } from './status.repository';
import type { CallbackRequestDto } from './dto/callback-request.dto';

/** `GET /c/{token}/status` response (LLD §Endpoint 1). No PII beyond display name. */
export interface CustomerStatusData {
  lead_code: string;
  customer_name: string;
  stage_label: string;
  stage_description: string;
  pending_actions: string[];
  is_handed_off: boolean;
  los_status_label: string | null;
}

/** `POST /c/{token}/callback` response (LLD §Endpoint 2). */
export interface CallbackData {
  task_id: string;
  message: string;
}

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24h
const CALLBACK_MESSAGE = "Your callback request has been received. We'll call you at your preferred time.";

/**
 * FR-062 — customer status view + callback request (M7). The status read maps the
 * internal stage to a customer-safe label; the callback creates a high-priority
 * `tasks` row (idempotent) for the lead's owner. No stage transition; no external
 * calls. The hot-flag side effect is deferred (LeadService.setHotFlag is a FR-031
 * stub — AMBIGUITY FR-062-A2).
 */
@Injectable()
export class StatusService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: StatusRepository,
    private readonly audit: AuditAppender,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectPinoLogger(StatusService.name) private readonly logger: PinoLogger,
  ) {}

  async getStatus(link: ResolvedCustomerLink): Promise<CustomerStatusData> {
    const lead = await this.repo.getLeadStatus(link.leadId, link.orgId);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    const display = CUSTOMER_STAGE_MAP[lead.stage as LeadStage] ?? {
      label: 'In Progress',
      description: 'We are processing your application.',
    };
    const name =
      (lead.customer_profile_id
        ? await this.repo.getProfileName(lead.customer_profile_id, link.orgId)
        : undefined) ?? 'Customer';

    const pendingActions =
      lead.stage === LeadStage.DOCUMENTS_PENDING
        ? (await this.repo.getPendingDocTypes(lead.lead_id, link.orgId)).map(
            (docType) => `Upload ${humanize(docType)}`,
          )
        : [];

    await this.audit.append({
      action: AuditAction.LINK_OPEN,
      // entity_id is the lead id (ResolvedCustomerLink doesn't expose the link id),
      // so entity_type is 'lead' to keep the audit row internally consistent.
      entity_type: 'lead',
      entity_id: lead.lead_id,
      actor_id: SYSTEM_USER_ID,
      org_id: link.orgId,
      lead_id: lead.lead_id,
      detail: { event: 'status_view' },
    });

    return {
      lead_code: lead.lead_code,
      customer_name: name,
      stage_label: display.label,
      stage_description: display.description,
      pending_actions: pendingActions,
      is_handed_off: lead.stage === LeadStage.HANDED_OFF,
      los_status_label: null,
    };
  }

  async requestCallback(
    link: ResolvedCustomerLink,
    dto: CallbackRequestDto,
    idempotencyKey: string | undefined,
  ): Promise<CallbackData> {
    const cacheKey = idempotencyKey ? `idempotency:callback:${idempotencyKey}` : null;
    if (cacheKey) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return { task_id: JSON.parse(cached).task_id as string, message: CALLBACK_MESSAGE };
      }
    }

    const taskId = await this.uow.run(async (tx) => {
      const lead = await this.repo.getLeadForCallback(link.leadId, link.orgId, tx);
      if (!lead) {
        throw new DomainException(ERROR_CODES.NOT_FOUND);
      }
      if (CALLBACK_BLOCKED_STAGES.has(lead.stage)) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
          fields: [
            { field: 'preferred_slot', issue: 'Callback requests cannot be made for applications in this status.' },
          ],
        });
      }

      // tasks.owner_id is NOT NULL; fall back to the system actor for an
      // unassigned lead (no UNASSIGNED_LEAD_OWNER_ID env — AMBIGUITY FR-062-A3).
      const ownerId = lead.owner_id ?? SYSTEM_USER_ID;
      if (!lead.owner_id) {
        this.logger.warn({ lead_id: lead.lead_id }, 'callback task on an unassigned lead → system actor owner');
      }

      const newTaskId = await this.repo.insertCallbackTask(
        {
          task_id: randomUUID(),
          org_id: link.orgId,
          lead_id: lead.lead_id,
          owner_id: ownerId,
          due_at: new Date(dto.preferred_slot),
          result_note: dto.note ?? null,
          actor_id: SYSTEM_USER_ID,
        },
        tx,
      );

      // Hot-flag side effect deferred: LeadService.setHotFlag is a FR-031 stub
      // (rejects). Recorded in AMBIGUITY FR-062-A2; wire when FR-031 lands.

      await this.audit.append(
        {
          action: AuditAction.COMM_SEND,
          entity_type: 'task',
          entity_id: newTaskId,
          actor_id: SYSTEM_USER_ID,
          org_id: link.orgId,
          lead_id: lead.lead_id,
          detail: { task_type: 'callback', preferred_slot: dto.preferred_slot },
        },
        tx,
      );

      return newTaskId;
    });

    if (cacheKey) {
      await this.redis.set(cacheKey, JSON.stringify({ task_id: taskId }), 'EX', IDEMPOTENCY_TTL_SECONDS);
    }

    return { task_id: taskId, message: CALLBACK_MESSAGE };
  }
}

/** `pan` → `Pan`, `address` → `Address` (doc_type → friendly action label). */
function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
