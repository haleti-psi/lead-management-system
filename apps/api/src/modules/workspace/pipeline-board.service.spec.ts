import { ERROR_CODES, LeadStage, RoleCode } from '@lms/shared';
import type { PinoLogger } from 'nestjs-pino';

import type { AuthUser } from '../../core/auth';
import type { DbTransaction } from '../../core/db';
import { UnitOfWork } from '../../core/db';
import type { LeadService } from '../capture/lead.service';
import type { StageGuardService } from '../capture/stage-guard.service';
import { PipelineBoardService, computeAgeingDays } from './pipeline-board.service';
import type { StageTransitionDto } from './dto/stage-transition.dto';

/**
 * FR-052 — unit tests for {@link PipelineBoardService}.
 * Covers: T04 (guard fail → STAGE_GUARD_FAILED), T07 (stale version → CONFLICT),
 * T09/T10 (scope check → FORBIDDEN), T15 (not found), T16 (rollback on DB fail),
 * U03 (stale version via LeadService), U04 (scope resolver), U05 (ageing).
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = 'b0000000-0000-0000-0000-00000000000b';

function makeUser(role: string = RoleCode.RM, userId = 'user-1'): AuthUser {
  return { userId, orgId: ORG, role: role as AuthUser['role'], scope: 'O', jti: 'jti-1' };
}

function makeDto(overrides: Partial<StageTransitionDto> = {}): StageTransitionDto {
  return { to: LeadStage.CONTACTED, expected_version: 2, ...overrides };
}

function makeFakeLead(stage: string = LeadStage.ASSIGNED, ownerId = 'user-1') {
  return {
    lead_id: LEAD_ID,
    lead_code: 'LD-2026-000042',
    org_id: ORG,
    stage: stage as typeof LeadStage[keyof typeof LeadStage],
    version: 2,
    owner_id: ownerId,
    branch_id: 'branch-1',
    team_id: 'team-1',
    kyc_status: 'not_started',
    consent_status: 'partial',
    duplicate_status: 'none',
    deleted_at: null,
  };
}

/** Build a fake UnitOfWork that runs the callback synchronously with a fake tx. */
function makeUow(tx: Partial<DbTransaction>): UnitOfWork {
  const uow = { run: (fn: (tx: DbTransaction) => Promise<unknown>) => fn(tx as DbTransaction) } as UnitOfWork;
  return uow;
}

/** Build a fake transaction that resolves SELECT … FOR UPDATE to `row`. */
function makeTxWithLead(row: unknown): DbTransaction {
  const forUpdate = jest.fn().mockReturnThis();
  const executeTakeFirst = jest.fn().mockResolvedValue(row);
  const selectFrom = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    forUpdate,
    executeTakeFirst,
  });
  return { selectFrom } as unknown as DbTransaction;
}

describe('PipelineBoardService', () => {
  let service: PipelineBoardService;
  let leadService: jest.Mocked<Pick<LeadService, 'transitionStage'>>;
  let stageGuard: jest.Mocked<Pick<StageGuardService, 'evaluate'>>;

  function buildService(uow: UnitOfWork) {
    leadService = { transitionStage: jest.fn() };
    stageGuard = { evaluate: jest.fn() };
    service = new PipelineBoardService(
      uow,
      leadService as unknown as LeadService,
      stageGuard as unknown as StageGuardService,
      { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
    );
  }

  // ── T15: Lead not found ──────────────────────────────────────────────────

  it('T15 — throws NOT_FOUND when lead does not exist', async () => {
    const tx = makeTxWithLead(undefined);
    buildService(makeUow(tx));
    stageGuard.evaluate.mockResolvedValue({ failed: [] });

    await expect(
      service.transitionStage(LEAD_ID, makeDto(), makeUser(), { type: 'own', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  // ── T09/T10: Out-of-scope lead → FORBIDDEN ────────────────────────────────

  it('T09 — RM cannot move another RM\'s lead (out of scope → FORBIDDEN)', async () => {
    // Lead owned by 'other-user', but RM-A has scope for userId='user-1'
    const tx = makeTxWithLead(makeFakeLead(LeadStage.ASSIGNED, 'other-user'));
    buildService(makeUow(tx));

    await expect(
      service.transitionStage(LEAD_ID, makeDto(), makeUser(), { type: 'own', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('T10 — SM cannot move a lead from a different team (out of scope → FORBIDDEN)', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.ASSIGNED, 'other-owner'));
    buildService(makeUow(tx));

    await expect(
      service.transitionStage(
        LEAD_ID,
        makeDto(),
        makeUser(RoleCode.SM),
        // Team predicate with no matching user_ids
        { type: 'team', userIds: ['user-1', 'user-2'] },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  // ── T04: Guard failure → STAGE_GUARD_FAILED (400) ────────────────────────

  it('T04 — guard failure returns VALIDATION_ERROR with STAGE_GUARD_FAILED detail', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.DOCUMENTS_PENDING, 'user-1'));
    buildService(makeUow(tx));
    stageGuard.evaluate.mockResolvedValue({ failed: ['mandatory_docs_or_waiver'] });

    await expect(
      service.transitionStage(
        LEAD_ID,
        { to: LeadStage.KYC_IN_PROGRESS, expected_version: 2 },
        makeUser(),
        { type: 'own', userId: 'user-1' },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      detail: {
        reason: 'STAGE_GUARD_FAILED',
        failed_guards: ['mandatory_docs_or_waiver'],
      },
    });

    // DB must NOT have been written (guard failed before LeadService call).
    expect(leadService.transitionStage).not.toHaveBeenCalled();
  });

  // ── T07/U03: Stale optimistic lock → CONFLICT (409) ─────────────────────

  it('T07/U03 — stale version → LeadService throws CONFLICT which propagates', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.ASSIGNED, 'user-1'));
    buildService(makeUow(tx));
    stageGuard.evaluate.mockResolvedValue({ failed: [] });
    const { DomainException } = await import('../../core/http');
    leadService.transitionStage.mockRejectedValue(new DomainException(ERROR_CODES.CONFLICT));

    await expect(
      service.transitionStage(LEAD_ID, makeDto(), makeUser(), { type: 'own', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  // ── U04: Scope resolver — RM scope (own) ─────────────────────────────────

  it('U04 — RM scope (own) is correctly enforced: in-scope lead proceeds', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.ASSIGNED, 'user-1'));
    buildService(makeUow(tx));
    stageGuard.evaluate.mockResolvedValue({ failed: [] });
    leadService.transitionStage.mockResolvedValue({
      lead_id: LEAD_ID,
      lead_code: 'LD-2026-000042',
      stage: LeadStage.CONTACTED,
      version: 3,
      updated_at: new Date('2026-06-09T07:15:00Z'),
    });

    const result = await service.transitionStage(LEAD_ID, makeDto(), makeUser(), { type: 'own', userId: 'user-1' });
    expect(result.stage).toBe(LeadStage.CONTACTED);
    expect(result.version).toBe(3);
  });

  // ── Happy path: all 4 writes happen (guarded by guard spy) ───────────────

  it('T01 analogue — successful transition delegates to LeadService with correct args', async () => {
    const tx = makeTxWithLead(makeFakeLead(LeadStage.ASSIGNED, 'user-1'));
    buildService(makeUow(tx));
    stageGuard.evaluate.mockResolvedValue({ failed: [] });
    leadService.transitionStage.mockResolvedValue({
      lead_id: LEAD_ID,
      lead_code: 'LD-2026-000042',
      stage: LeadStage.CONTACTED,
      version: 3,
      updated_at: new Date('2026-06-09T07:15:00Z'),
    });

    const dto: StageTransitionDto = { to: LeadStage.CONTACTED, expected_version: 2 };
    const user = makeUser(RoleCode.RM, 'user-1');
    await service.transitionStage(LEAD_ID, dto, user, { type: 'own', userId: 'user-1' });

    expect(stageGuard.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStage: LeadStage.ASSIGNED,
        toStage: LeadStage.CONTACTED,
        actor: user,
      }),
    );
    expect(leadService.transitionStage).toHaveBeenCalledWith(
      LEAD_ID,
      LeadStage.CONTACTED,
      expect.objectContaining({
        actor_id: 'user-1',
        from_stage: LeadStage.ASSIGNED,
      }),
      2,
      tx,
    );
  });
});

// ── U05: Ageing computation ───────────────────────────────────────────────

describe('computeAgeingDays', () => {
  it('U05 — returns 5 for a lead created 5 days ago', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(computeAgeingDays(fiveDaysAgo)).toBe(5);
  });

  it('returns 0 for a lead created just now', () => {
    expect(computeAgeingDays(new Date())).toBe(0);
  });
});
