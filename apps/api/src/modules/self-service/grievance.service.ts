import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditAction, EventCode } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { OutboxService } from '../../core/outbox';
import { CodeGenerator } from '../capture/code-generator.service';
import { SYSTEM_USER_ID } from '../identity/identity.constants';
import type { ResolvedCustomerLink } from '../compliance/ports/customer-link.port';
import { GrievanceRepository } from './grievance.repository';
import type { CreateGrievanceDto } from './dto/create-grievance.dto';

/** `POST /c/{token}/grievance` response (LLD §Response). */
export interface CreateGrievanceData {
  grievanceId: string;
  grievanceNo: string;
  status: string;
  sla_due_at: Date | null;
  message: string;
}

const GRIEVANCE_ENTITY = 'grievance';
const MINUTE_MS = 60_000;

/**
 * FR-061 — customer grievance intake (M7 intake / M12 entity). Creates a
 * `grievances` row (status `open`, source `customer_link`) from a token-scoped
 * customer request, with the grievance number, SLA due-at, `GRIEVANCE_CREATED`
 * outbox, and audit intent committed atomically. Owner assignment + workflow
 * transitions are FR-114 (internal console).
 */
@Injectable()
export class GrievanceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: GrievanceRepository,
    private readonly codeGen: CodeGenerator,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
  ) {}

  async createFromCustomerLink(
    link: ResolvedCustomerLink,
    dto: CreateGrievanceDto,
  ): Promise<CreateGrievanceData> {
    // Grievance SLA is non-blocking: a missing policy → no due-at (LLD §2).
    const thresholdMinutes = await this.repo.findGrievanceSlaThresholdMinutes(link.orgId);
    const slaDueAt = thresholdMinutes != null ? new Date(Date.now() + thresholdMinutes * MINUTE_MS) : null;

    const grievance = await this.uow.run(async (tx) => {
      const grievanceId = randomUUID();
      const grievanceNo = await this.codeGen.nextGrievanceNo(tx, link.orgId);

      const row = await this.repo.insert(
        {
          grievance_id: grievanceId,
          org_id: link.orgId,
          grievance_no: grievanceNo,
          lead_id: link.leadId,
          category: dto.category,
          description: dto.description,
          sla_due_at: slaDueAt,
          actor_id: SYSTEM_USER_ID,
        },
        tx,
      );

      await this.outbox.emit(
        {
          event_code: EventCode.GRIEVANCE_CREATED,
          aggregate_type: GRIEVANCE_ENTITY,
          aggregate_id: grievanceId,
          payload: {
            grievance_no: grievanceNo,
            lead_id: link.leadId,
            category: dto.category,
            source: 'customer_link',
          },
        },
        tx,
      );

      await this.audit.append(
        {
          // AMB-1: no `grievance_create` audit_action value; `lead_create` is the
          // closest available (entity_type disambiguates). Flagged for write-back.
          action: AuditAction.LEAD_CREATE,
          entity_type: GRIEVANCE_ENTITY,
          entity_id: grievanceId,
          actor_id: SYSTEM_USER_ID,
          org_id: link.orgId,
          lead_id: link.leadId,
          detail: { grievance_no: grievanceNo, category: dto.category, source: 'customer_link' },
        },
        tx,
      );

      return row;
    });

    return {
      grievanceId: grievance.grievance_id,
      grievanceNo: grievance.grievance_no,
      status: grievance.status,
      sla_due_at: grievance.sla_due_at,
      message: `Your grievance has been registered. Reference: ${grievance.grievance_no}.`,
    };
  }
}
