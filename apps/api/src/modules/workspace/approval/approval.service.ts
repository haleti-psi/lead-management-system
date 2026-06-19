import { Injectable } from '@nestjs/common';

import { ApprovalDecision, ERROR_CODES, LeadStage } from '@lms/shared';

import type { AuthUser } from '../../../core/auth';
import { UnitOfWork } from '../../../core/db';
import { DomainException } from '../../../core/http';
import { LeadService } from '../../capture/lead.service';
import type { ApprovalDto } from './dto/approval.dto';
import { ApprovalRepository } from './approval.repository';

/** Response shape for a successful approval decision (FR-055 LLD §Endpoints). */
export interface ApprovalResult {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  approval_status: string;
  decision: ApprovalDecision;
  decided_by: string;
  decided_at: Date;
}

/**
 * FR-055 — `ApprovalService`: the orchestrator for the lead-approval gate.
 *
 * Sequence (LLD §Backend Flow §6):
 *  6a. SELECT … FOR UPDATE to lock and load the lead
 *  6b. Assert `stage === 'pending_approval'` → CONFLICT if not
 *  6c. `ApprovalRepository.insert` (owns `lead_approvals`)
 *  6d. `LeadService.recordApprovalDecision` — sole writer of `leads`
 *
 * All four writes (lead_approvals, leads UPDATE, stage_history, event_outbox)
 * execute in one `UnitOfWork` transaction — any failure rolls everything back.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly approvalRepo: ApprovalRepository,
    private readonly leadService: LeadService,
  ) {}

  async decide(leadId: string, dto: ApprovalDto, actor: AuthUser): Promise<ApprovalResult> {
    return this.uow.run(async (tx) => {
      // 6a. Lock and load (SELECT … FOR UPDATE).
      const lead = await tx
        .selectFrom('leads')
        .select(['lead_id', 'lead_code', 'org_id', 'stage', 'branch_id', 'team_id', 'owner_id', 'version', 'deleted_at'])
        .where('lead_id', '=', leadId)
        .where('org_id', '=', actor.orgId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();

      if (!lead) {
        throw new DomainException(ERROR_CODES.NOT_FOUND);
      }

      // 6b. Stage gate — must be pending_approval.
      if (lead.stage !== LeadStage.PENDING_APPROVAL) {
        throw new DomainException(
          ERROR_CODES.CONFLICT,
          'Lead is not in pending_approval stage; cannot decide approval.',
        );
      }

      // Map the request verb ('approve'/'reject') to the stored enum ('approved'/'rejected').
      const storedDecision = dto.decision === ApprovalDecision.APPROVE ? 'approved' : 'rejected';

      // 6c. Insert lead_approvals row (this module OWNS that table).
      await this.approvalRepo.insert(tx, {
        lead_id: leadId,
        decision: storedDecision,
        reason: dto.reason ?? null,
        decided_by: actor.userId,
        org_id: lead.org_id,
      });

      // 6d. Delegate stage transition + leads UPDATE + stage_history + audit + outbox
      // to the sole writer of `leads`.
      const decidedAt = new Date();
      const updated = await this.leadService.recordApprovalDecision(
        leadId,
        dto.decision,
        dto.reason ?? null,
        actor.userId,
        tx,
      );

      return {
        lead_id: updated.lead_id,
        lead_code: updated.lead_code,
        stage: updated.stage,
        approval_status: updated.approval_status,
        decision: dto.decision,
        decided_by: actor.userId,
        decided_at: decidedAt,
      };
    });
  }
}
