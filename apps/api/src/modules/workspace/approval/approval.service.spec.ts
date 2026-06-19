import { ApprovalDecision, ERROR_CODES, LeadStage } from '@lms/shared';

import type { AuthUser } from '../../../core/auth';
import type { DbTransaction } from '../../../core/db';
import { UnitOfWork } from '../../../core/db';
import { DomainException } from '../../../core/http';
import type { LeadService } from '../../capture/lead.service';
import { ApprovalRepository } from './approval.repository';
import { ApprovalService } from './approval.service';
import type { ApprovalDto } from './dto/approval.dto';

/**
 * FR-055 — unit tests for {@link ApprovalService}.
 * Covers: approve happy path, reject happy path,
 * reject-without-reason (VALIDATION_ERROR via Zod — enforced at controller,
 * but service also receives a DTO; tested via Zod schema in dto spec),
 * not-in-pending_approval → CONFLICT (409).
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = 'b0000000-0000-0000-0000-00000000000b';
const ACTOR_ID = 'actor-bm-001';

function makeUser(userId = ACTOR_ID): AuthUser {
  return { userId, orgId: ORG, role: 'BM', scope: 'B', jti: 'jti-1' };
}

function makeApproveDto(): ApprovalDto {
  return { decision: ApprovalDecision.APPROVE };
}

function makeRejectDto(reason = 'Credit profile insufficient for the requested amount.'): ApprovalDto {
  return { decision: ApprovalDecision.REJECT, reason };
}

function makeFakeLead(stage: string = LeadStage.PENDING_APPROVAL) {
  return {
    lead_id: LEAD_ID,
    lead_code: 'LD-2026-000099',
    org_id: ORG,
    stage,
    branch_id: 'branch-1',
    team_id: 'team-1',
    owner_id: 'owner-1',
    version: 3,
    deleted_at: null,
  };
}

function makeRecordApprovalResult(stage: LeadStage, approvalStatus: string) {
  return {
    lead_id: LEAD_ID,
    lead_code: 'LD-2026-000099',
    stage,
    approval_status: approvalStatus,
    version: 4,
  };
}

/** Build a fake UnitOfWork that runs the callback synchronously with a fake tx. */
function makeUow(tx: Partial<DbTransaction>): UnitOfWork {
  return {
    run: (fn: (tx: DbTransaction) => Promise<unknown>) => fn(tx as DbTransaction),
  } as UnitOfWork;
}

/** Build a fake transaction whose selectFrom resolves to `lead`. */
function makeTxWithLead(lead: unknown): DbTransaction {
  const forUpdate = jest.fn().mockReturnThis();
  const executeTakeFirst = jest.fn().mockResolvedValue(lead);
  const selectFrom = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    forUpdate,
    executeTakeFirst,
  });
  return { selectFrom } as unknown as DbTransaction;
}

describe('ApprovalService', () => {
  let service: ApprovalService;
  let approvalRepo: jest.Mocked<Pick<ApprovalRepository, 'insert'>>;
  let leadService: jest.Mocked<Pick<LeadService, 'recordApprovalDecision'>>;

  function buildService(uow: UnitOfWork) {
    approvalRepo = { insert: jest.fn().mockResolvedValue(undefined) };
    leadService = { recordApprovalDecision: jest.fn() };
    service = new ApprovalService(
      uow,
      approvalRepo as unknown as ApprovalRepository,
      leadService as unknown as LeadService,
    );
  }

  // ── Approve happy path ────────────────────────────────────────────────────

  it('approve happy path — inserts approval row, delegates to LeadService, returns result', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.PENDING_APPROVAL));
    buildService(makeUow(tx));
    leadService.recordApprovalDecision.mockResolvedValue(
      makeRecordApprovalResult(LeadStage.READY_FOR_HANDOFF, 'approved'),
    );

    const result = await service.decide(LEAD_ID, makeApproveDto(), makeUser());

    // ApprovalRepository.insert called with stored decision 'approved'
    expect(approvalRepo.insert).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        lead_id: LEAD_ID,
        decision: 'approved',
        reason: null,
        decided_by: ACTOR_ID,
        org_id: ORG,
      }),
    );
    // LeadService.recordApprovalDecision called
    expect(leadService.recordApprovalDecision).toHaveBeenCalledWith(
      LEAD_ID,
      ApprovalDecision.APPROVE,
      null,
      ACTOR_ID,
      tx,
    );
    expect(result.stage).toBe(LeadStage.READY_FOR_HANDOFF);
    expect(result.approval_status).toBe('approved');
    expect(result.decision).toBe(ApprovalDecision.APPROVE);
    expect(result.decided_by).toBe(ACTOR_ID);
    expect(result.lead_id).toBe(LEAD_ID);
  });

  // ── Reject happy path ─────────────────────────────────────────────────────

  it('reject happy path — inserts approval row with reason, returns rejected stage', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.PENDING_APPROVAL));
    buildService(makeUow(tx));
    const reason = 'Credit profile insufficient for the requested amount.';
    leadService.recordApprovalDecision.mockResolvedValue(
      makeRecordApprovalResult(LeadStage.REJECTED, 'rejected'),
    );

    const result = await service.decide(LEAD_ID, makeRejectDto(reason), makeUser());

    expect(approvalRepo.insert).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        lead_id: LEAD_ID,
        decision: 'rejected',
        reason,
        decided_by: ACTOR_ID,
      }),
    );
    expect(leadService.recordApprovalDecision).toHaveBeenCalledWith(
      LEAD_ID,
      ApprovalDecision.REJECT,
      reason,
      ACTOR_ID,
      tx,
    );
    expect(result.stage).toBe(LeadStage.REJECTED);
    expect(result.approval_status).toBe('rejected');
    expect(result.decision).toBe(ApprovalDecision.REJECT);
  });

  // ── Lead not in pending_approval → CONFLICT (409) ────────────────────────

  it('throws CONFLICT when lead is not in pending_approval stage', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.ELIGIBILITY_REQUESTED));
    buildService(makeUow(tx));

    await expect(service.decide(LEAD_ID, makeApproveDto(), makeUser())).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(approvalRepo.insert).not.toHaveBeenCalled();
    expect(leadService.recordApprovalDecision).not.toHaveBeenCalled();
  });

  // ── Lead not found → NOT_FOUND (404) ─────────────────────────────────────

  it('throws NOT_FOUND when lead does not exist', async () => {
    const tx = makeTxWithLead(undefined);
    buildService(makeUow(tx));

    await expect(service.decide(LEAD_ID, makeApproveDto(), makeUser())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    expect(approvalRepo.insert).not.toHaveBeenCalled();
  });

  // ── LeadService error propagates through UoW ─────────────────────────────

  it('propagates LeadService error (CONFLICT) — atomicity maintained', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.PENDING_APPROVAL));
    buildService(makeUow(tx));
    leadService.recordApprovalDecision.mockRejectedValue(new DomainException(ERROR_CODES.CONFLICT));

    await expect(service.decide(LEAD_ID, makeApproveDto(), makeUser())).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });
});
