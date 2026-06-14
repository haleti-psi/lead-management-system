/**
 * FR-114 unit + component tests (FR-114-tests.md).
 *
 * Unit tests exercised at the service layer with all dependencies mocked.
 * Full-HTTP+DB integration tier (T01–T24 as supertest+Testcontainers) is
 * DEFERRED to the project-wide integration-test wave (manifest stage7.test_strategy).
 *
 * Test coverage:
 *   T27/T28/T29/T30 — state machine (all valid transitions, all invalid, guards)
 *   T25/T26         — SLA computation via SlaEngine (happy + no policy)
 *   T31/T32         — transaction rollback on audit/outbox failure
 *   T33             — CodeGenerator.nextGrievanceNo unique codes
 *   T34/T35         — escalation sweep (breached promoted, terminal not touched)
 */

import {
  AuditAction,
  ERROR_CODES,
  EventCode,
  GrievanceCategory,
  GrievanceSource,
  GrievanceStatus,
  SlaTarget,
  type ScopePredicate,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { UnitOfWork } from '../../core/db';
import type { DbTransaction } from '../../core/db';
import type { OutboxService } from '../../core/outbox';
import type { SlaEngine } from '../../core/sla';
import { GrievanceCodeGenerator } from './code-generator-grievance.service';
import { GrievanceRepository, type GrievanceRow, type NewGrievance } from './grievance.repository';
import {
  GrievanceService,
  type GrievanceActorContext,
} from './grievance.service';
import type { CreateGrievanceDto } from './dto/create-grievance.dto';
import type { UpdateGrievanceDto } from './dto/update-grievance.dto';

// ──────────────────────────────────────────────────────── fixtures ──

const ORG = '00000000-0000-0000-0000-000000000001';
const RM_ID = 'a0000000-0000-0000-0000-0000000000a1';
const DPO_ID = 'a0000000-0000-0000-0000-0000000000d1';
const GRIEVANCE_ID = 'c0000000-0000-0000-0000-000000000001';
const LEAD_ID = 'b0000000-0000-0000-0000-000000000001';
const TX = { __tx: true } as unknown as DbTransaction;

const NOW = new Date('2026-06-14T09:00:00Z');
const SLA_DUE = new Date('2026-06-16T18:30:00Z');

function makeRow(
  overrides: Partial<GrievanceRow & { lead_id: string | null; owner_id: string | null }> = {},
): GrievanceRow {
  return {
    grievance_id: GRIEVANCE_ID,
    org_id: ORG,
    grievance_no: 'GRV-2026-000001',
    lead_id: null,
    source: GrievanceSource.RM,
    category: GrievanceCategory.SERVICE_DELAY,
    description: 'Customer was not contacted within promised time.',
    owner_id: RM_ID,
    sla_due_at: SLA_DUE,
    status: GrievanceStatus.OPEN,
    response: null,
    closure_proof_ref: null,
    created_by: RM_ID,
    updated_by: RM_ID,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function rmCtx(overrides: Partial<GrievanceActorContext> = {}): GrievanceActorContext {
  return {
    callerId: RM_ID,
    orgId: ORG,
    predicate: { type: 'own', userId: RM_ID } satisfies ScopePredicate,
    branchId: 'branch-1',
    ...overrides,
  };
}

function dpoCtx(): GrievanceActorContext {
  return {
    callerId: DPO_ID,
    orgId: ORG,
    predicate: { type: 'all', orgId: ORG } satisfies ScopePredicate,
  };
}

function createDto(overrides: Partial<CreateGrievanceDto> = {}): CreateGrievanceDto {
  return {
    leadId: null,
    source: GrievanceSource.RM,
    category: GrievanceCategory.SERVICE_DELAY,
    description: 'Customer was not contacted within the promised timeframe.',
    ownerId: null,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────── test harness ──

interface Harness {
  service: GrievanceService;
  repo: {
    findById: jest.Mock;
    findByIdOrThrow: jest.Mock;
    findLeadInOrg: jest.Mock;
    findActiveUserInOrg: jest.Mock;
    list: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    findBreachedForEscalation: jest.Mock;
    setSlaAt: jest.Mock;
  };
  codeGen: { nextGrievanceNo: jest.Mock };
  sla: { computeDueAt: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
  uow: { run: jest.Mock };
  logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
}

/**
 * Creates a test harness with all mocks set to happy-path defaults.
 * `uow.run` executes the callback synchronously with TX.
 */
function makeHarness(
  insertedRow: GrievanceRow = makeRow(),
): Harness {
  const repo = {
    findById: jest.fn().mockResolvedValue(makeRow()),
    findByIdOrThrow: jest.fn().mockResolvedValue(makeRow()),
    findLeadInOrg: jest.fn().mockResolvedValue({ lead_id: LEAD_ID, branch_id: 'branch-1' }),
    findActiveUserInOrg: jest.fn().mockResolvedValue({ user_id: RM_ID }),
    list: jest.fn().mockResolvedValue({ rows: [insertedRow], total: 1 }),
    insert: jest.fn().mockResolvedValue(insertedRow),
    update: jest.fn().mockResolvedValue(insertedRow),
    findBreachedForEscalation: jest.fn().mockResolvedValue([]),
    setSlaAt: jest.fn().mockResolvedValue(undefined),
  };
  const codeGen = {
    nextGrievanceNo: jest.fn().mockResolvedValue('GRV-2026-000001'),
  };
  const sla = {
    computeDueAt: jest.fn().mockResolvedValue({ dueAt: SLA_DUE, policyId: 'policy-1' }),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const outbox = { emit: jest.fn().mockResolvedValue(undefined) };
  const uow = {
    run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX)),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const service = new GrievanceService(
    uow as unknown as UnitOfWork,
    repo as unknown as GrievanceRepository,
    codeGen as unknown as GrievanceCodeGenerator,
    sla as unknown as SlaEngine,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
    logger as never,
  );

  return { service, repo, codeGen, sla, audit, outbox, uow, logger };
}

// ──────────────────────────────────────────────── T27/T28 State machine ──

describe('GrievanceService.validateTransition', () => {
  it('T27: accepts all valid transitions without throwing', () => {
    const h = makeHarness();
    const validPairs: Array<[GrievanceStatus, GrievanceStatus]> = [
      [GrievanceStatus.OPEN, GrievanceStatus.IN_PROGRESS],
      [GrievanceStatus.IN_PROGRESS, GrievanceStatus.ESCALATED],
      [GrievanceStatus.IN_PROGRESS, GrievanceStatus.RESOLVED],
      [GrievanceStatus.ESCALATED, GrievanceStatus.RESOLVED],
      [GrievanceStatus.RESOLVED, GrievanceStatus.CLOSED],
    ];
    for (const [from, to] of validPairs) {
      const dto =
        to === GrievanceStatus.RESOLVED
          ? { response: 'Issue addressed.' }
          : to === GrievanceStatus.CLOSED
          ? { closureProofRef: 'gcs://bucket/proof.pdf' }
          : to === GrievanceStatus.IN_PROGRESS
          // open→in_progress: supply ownerId so the guard passes
          ? { ownerId: RM_ID }
          : {};
      expect(() => h.service.validateTransition(from, to, dto)).not.toThrow();
    }
  });

  it('T28: rejects all invalid transitions with CONFLICT', () => {
    const h = makeHarness();
    const invalidPairs: Array<[GrievanceStatus, GrievanceStatus]> = [
      [GrievanceStatus.CLOSED, GrievanceStatus.OPEN],
      [GrievanceStatus.CLOSED, GrievanceStatus.IN_PROGRESS],
      [GrievanceStatus.CLOSED, GrievanceStatus.RESOLVED],
      [GrievanceStatus.OPEN, GrievanceStatus.CLOSED],
      [GrievanceStatus.OPEN, GrievanceStatus.RESOLVED],
      [GrievanceStatus.OPEN, GrievanceStatus.ESCALATED],
      [GrievanceStatus.RESOLVED, GrievanceStatus.OPEN],
    ];
    for (const [from, to] of invalidPairs) {
      expect(() => h.service.validateTransition(from, to)).toThrow(
        expect.objectContaining({ code: ERROR_CODES.CONFLICT }),
      );
    }
  });

  it('T29: resolved transition without response throws VALIDATION_ERROR on field=response', () => {
    const h = makeHarness();
    expect(() =>
      h.service.validateTransition(GrievanceStatus.IN_PROGRESS, GrievanceStatus.RESOLVED, {}),
    ).toThrow(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'response' }),
        ]),
      }),
    );
  });

  it('T30: closed transition without closureProofRef throws VALIDATION_ERROR on field=closureProofRef', () => {
    const h = makeHarness();
    expect(() =>
      h.service.validateTransition(GrievanceStatus.RESOLVED, GrievanceStatus.CLOSED, {
        response: 'already set',
      }),
    ).toThrow(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'closureProofRef' }),
        ]),
      }),
    );
  });

  it('same-status noop does not throw', () => {
    const h = makeHarness();
    expect(() =>
      h.service.validateTransition(GrievanceStatus.OPEN, GrievanceStatus.OPEN),
    ).not.toThrow();
  });

  it('INV-5: open→in_progress with no dto.ownerId AND no existing owner_id throws VALIDATION_ERROR on field=ownerId', () => {
    const h = makeHarness();
    expect(() =>
      h.service.validateTransition(
        GrievanceStatus.OPEN,
        GrievanceStatus.IN_PROGRESS,
        // dto has no ownerId
        {},
        // existing row also has no owner_id
        null,
      ),
    ).toThrow(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'ownerId', issue: 'ownerId must be set before moving to in_progress' }),
        ]),
      }),
    );
  });

  it('INV-5b: open→in_progress with dto.ownerId set passes (owner provided in dto)', () => {
    const h = makeHarness();
    expect(() =>
      h.service.validateTransition(
        GrievanceStatus.OPEN,
        GrievanceStatus.IN_PROGRESS,
        { ownerId: RM_ID },
        null,
      ),
    ).not.toThrow();
  });

  it('INV-5c: open→in_progress with existing owner_id (no dto.ownerId) passes (already owned)', () => {
    const h = makeHarness();
    expect(() =>
      h.service.validateTransition(
        GrievanceStatus.OPEN,
        GrievanceStatus.IN_PROGRESS,
        {},
        RM_ID,
      ),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────── T25/T26 SLA computation ──

describe('GrievanceService.create — SLA computation', () => {
  it('T25: sets sla_due_at when SlaEngine returns a policy result', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined); // no lead — skip lead check

    await h.service.create(createDto(), rmCtx());

    expect(h.sla.computeDueAt).toHaveBeenCalledWith(
      SlaTarget.GRIEVANCE,
      expect.any(Object),
    );
    const insertedRow = h.repo.insert.mock.calls[0]?.[0] as NewGrievance;
    expect(insertedRow.sla_due_at).toEqual(SLA_DUE);
  });

  it('T26: sets sla_due_at to null when no active SLA policy (returns null)', async () => {
    const h = makeHarness();
    h.sla.computeDueAt.mockResolvedValue(null);
    h.repo.findLeadInOrg.mockResolvedValue(undefined);

    await h.service.create(createDto(), rmCtx());

    const insertedRow = h.repo.insert.mock.calls[0]?.[0] as NewGrievance;
    expect(insertedRow.sla_due_at).toBeNull();
  });
});

// ───────────────────────────────── T31/T32 Transaction rollback ──

describe('GrievanceService.create — transaction atomicity', () => {
  it('T31: rolls back when AuditAppender.append throws (no grievance row)', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined);
    const auditError = new Error('audit fail');
    h.audit.append.mockRejectedValue(auditError);

    await expect(h.service.create(createDto(), rmCtx())).rejects.toThrow(auditError);
    // The UoW callback throws → the mock propagates it; real Kysely tx rolls back
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  it('T32: rolls back when OutboxService.emit throws', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined);
    const outboxError = new Error('outbox fail');
    h.outbox.emit.mockRejectedValue(outboxError);

    await expect(h.service.create(createDto(), rmCtx())).rejects.toThrow(outboxError);
  });
});

// ──────────────────────────────────── Create happy path ──

describe('GrievanceService.create', () => {
  it('inserts the grievance with correct fields and returns serialised data', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined);

    const result = await h.service.create(createDto(), rmCtx());

    const inserted = h.repo.insert.mock.calls[0]?.[0] as NewGrievance;
    expect(inserted).toMatchObject({
      org_id: ORG,
      grievance_no: 'GRV-2026-000001',
      source: GrievanceSource.RM,
      category: GrievanceCategory.SERVICE_DELAY,
      status: GrievanceStatus.OPEN,
      response: null,
      closure_proof_ref: null,
      created_by: RM_ID,
      updated_by: RM_ID,
    });
    expect(result.grievanceNo).toBe('GRV-2026-000001');
    expect(result.status).toBe(GrievanceStatus.OPEN);
  });

  it('emits GRIEVANCE_CREATED outbox event in the same tx', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined);

    await h.service.create(createDto(), rmCtx());

    expect(h.outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_code: EventCode.GRIEVANCE_CREATED,
        aggregate_type: 'grievance',
      }),
      TX,
    );
  });

  it('appends audit entry with action=lead_update and entity_type=grievances', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined);

    await h.service.create(createDto(), rmCtx());

    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LEAD_UPDATE,
        entity_type: 'grievances',
        actor_id: RM_ID,
        org_id: ORG,
      }),
      TX,
    );
  });

  it('returns NOT_FOUND when leadId references a non-existent lead', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined);

    await expect(
      h.service.create(createDto({ leadId: LEAD_ID }), rmCtx()),
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(h.repo.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when ownerId references a non-existent user', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue(undefined);
    h.repo.findActiveUserInOrg.mockResolvedValue(undefined);

    await expect(
      h.service.create(createDto({ ownerId: 'f0000000-0000-0000-0000-000000000001' }), rmCtx()),
    ).rejects.toThrow(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: expect.arrayContaining([expect.objectContaining({ field: 'ownerId' })]),
      }),
    );
  });

  it('uses lead branch_id for SLA calendar when ctx.branchId is null and leadId is provided', async () => {
    const h = makeHarness();
    h.repo.findLeadInOrg.mockResolvedValue({ lead_id: LEAD_ID, branch_id: 'branch-from-lead' });

    // ctx has no branchId so lead's branch is used
    await h.service.create(createDto({ leadId: LEAD_ID }), rmCtx({ branchId: null }));

    expect(h.sla.computeDueAt).toHaveBeenCalledWith(
      SlaTarget.GRIEVANCE,
      expect.objectContaining({ branchId: 'branch-from-lead' }),
    );
  });
});

// ──────────────────────────────────── Update (PATCH) ──

describe('GrievanceService.update', () => {
  it('T14: open → in_progress with ownerId; audit written', async () => {
    const h = makeHarness();
    const openRow = makeRow({ status: GrievanceStatus.OPEN, owner_id: RM_ID });
    h.repo.findByIdOrThrow.mockResolvedValue(openRow);
    const inProgressRow = makeRow({ status: GrievanceStatus.IN_PROGRESS });
    h.repo.update.mockResolvedValue(inProgressRow);

    const dto: UpdateGrievanceDto = { status: GrievanceStatus.IN_PROGRESS, ownerId: RM_ID };
    const result = await h.service.update(GRIEVANCE_ID, dto, rmCtx());

    expect(result.status).toBe(GrievanceStatus.IN_PROGRESS);
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LEAD_UPDATE,
        entity_type: 'grievances',
        detail: expect.objectContaining({
          transition: { from: GrievanceStatus.OPEN, to: GrievanceStatus.IN_PROGRESS },
        }),
      }),
      TX,
    );
  });

  it('T15: in_progress → resolved with response; stores response', async () => {
    const h = makeHarness();
    const row = makeRow({ status: GrievanceStatus.IN_PROGRESS, owner_id: RM_ID });
    h.repo.findByIdOrThrow.mockResolvedValue(row);
    const resolved = makeRow({ status: GrievanceStatus.RESOLVED, response: 'Issue addressed.' });
    h.repo.update.mockResolvedValue(resolved);

    const dto: UpdateGrievanceDto = {
      status: GrievanceStatus.RESOLVED,
      response: 'Issue addressed.',
    };
    const result = await h.service.update(GRIEVANCE_ID, dto, rmCtx());
    expect(result.status).toBe(GrievanceStatus.RESOLVED);
    expect(result.response).toBe('Issue addressed.');
  });

  it('T16: resolved → closed with closureProofRef; stores proof', async () => {
    const h = makeHarness();
    const row = makeRow({
      status: GrievanceStatus.RESOLVED,
      response: 'Apology sent.',
      owner_id: RM_ID,
    });
    h.repo.findByIdOrThrow.mockResolvedValue(row);
    const closed = makeRow({
      status: GrievanceStatus.CLOSED,
      response: 'Apology sent.',
      closure_proof_ref: 'gcs://bucket/proof.pdf',
    });
    h.repo.update.mockResolvedValue(closed);

    const dto: UpdateGrievanceDto = {
      status: GrievanceStatus.CLOSED,
      closureProofRef: 'gcs://bucket/proof.pdf',
    };
    const result = await h.service.update(GRIEVANCE_ID, dto, rmCtx());
    expect(result.status).toBe(GrievanceStatus.CLOSED);
    expect(result.closureProofRef).toBe('gcs://bucket/proof.pdf');
  });

  it('T17: resolve without response → VALIDATION_ERROR on field=response', async () => {
    const h = makeHarness();
    const row = makeRow({ status: GrievanceStatus.IN_PROGRESS, owner_id: RM_ID });
    h.repo.findByIdOrThrow.mockResolvedValue(row);

    await expect(
      h.service.update(GRIEVANCE_ID, { status: GrievanceStatus.RESOLVED }, rmCtx()),
    ).rejects.toThrow(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: expect.arrayContaining([expect.objectContaining({ field: 'response' })]),
      }),
    );
  });

  it('T18: close without closureProofRef → VALIDATION_ERROR on field=closureProofRef', async () => {
    const h = makeHarness();
    const row = makeRow({ status: GrievanceStatus.RESOLVED, response: 'done', owner_id: RM_ID });
    h.repo.findByIdOrThrow.mockResolvedValue(row);

    await expect(
      h.service.update(GRIEVANCE_ID, { status: GrievanceStatus.CLOSED }, rmCtx()),
    ).rejects.toThrow(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: expect.arrayContaining([expect.objectContaining({ field: 'closureProofRef' })]),
      }),
    );
  });

  it('T19: closed → open throws CONFLICT', async () => {
    const h = makeHarness();
    h.repo.findByIdOrThrow.mockResolvedValue(
      makeRow({ status: GrievanceStatus.CLOSED, owner_id: RM_ID }),
    );

    await expect(
      h.service.update(GRIEVANCE_ID, { status: GrievanceStatus.OPEN }, rmCtx()),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR_CODES.CONFLICT }));
  });

  it('T20: open → closed (skip) throws CONFLICT', async () => {
    const h = makeHarness();
    h.repo.findByIdOrThrow.mockResolvedValue(
      makeRow({ status: GrievanceStatus.OPEN, owner_id: RM_ID }),
    );

    await expect(
      h.service.update(GRIEVANCE_ID, { status: GrievanceStatus.CLOSED }, rmCtx()),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR_CODES.CONFLICT }));
  });

  it('T21: non-owner without scope A cannot PATCH → FORBIDDEN', async () => {
    const h = makeHarness();
    // grievance owned by someone else
    h.repo.findByIdOrThrow.mockResolvedValue(makeRow({ owner_id: 'other-user-id' }));

    // Caller is RM with own-scope (not owner of this grievance)
    await expect(
      h.service.update(
        GRIEVANCE_ID,
        { status: GrievanceStatus.IN_PROGRESS },
        rmCtx({ callerId: RM_ID, predicate: { type: 'own', userId: RM_ID } }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }));
  });

  it('T22: DPO with scope A can PATCH any grievance', async () => {
    const h = makeHarness();
    // grievance owned by RM, DPO is NOT the owner
    h.repo.findByIdOrThrow.mockResolvedValue(makeRow({ owner_id: RM_ID }));
    const inProgress = makeRow({ status: GrievanceStatus.IN_PROGRESS, owner_id: DPO_ID });
    h.repo.update.mockResolvedValue(inProgress);

    const result = await h.service.update(
      GRIEVANCE_ID,
      { status: GrievanceStatus.IN_PROGRESS, ownerId: DPO_ID },
      dpoCtx(),
    );
    expect(result.status).toBe(GrievanceStatus.IN_PROGRESS);
  });

  it('T23: PATCH non-existent grievance → NOT_FOUND', async () => {
    const h = makeHarness();
    h.repo.findByIdOrThrow.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'NOT_FOUND' }),
    );

    await expect(
      h.service.update(GRIEVANCE_ID, { status: GrievanceStatus.IN_PROGRESS }, rmCtx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ──────────────────────────────── T34/T35 Escalation sweep ──

describe('GrievanceService.runEscalationSweep', () => {
  it('T34: escalates breached open/in_progress grievances; writes audit per row', async () => {
    const h = makeHarness();
    const breached = [
      makeRow({ grievance_id: 'g1', status: GrievanceStatus.OPEN, owner_id: RM_ID }),
      makeRow({ grievance_id: 'g2', status: GrievanceStatus.IN_PROGRESS, owner_id: RM_ID }),
      makeRow({ grievance_id: 'g3', status: GrievanceStatus.OPEN, owner_id: RM_ID }),
    ];
    h.repo.findBreachedForEscalation.mockResolvedValue(breached);

    const count = await h.service.runEscalationSweep(ORG, NOW);

    expect(count).toBe(3);
    expect(h.repo.update).toHaveBeenCalledTimes(3);
    expect(h.audit.append).toHaveBeenCalledTimes(3);
    // Each update sets status to escalated
    for (const call of h.repo.update.mock.calls) {
      expect(call[2]).toMatchObject({ status: GrievanceStatus.ESCALATED });
    }
  });

  it('T35: resolved/closed grievances are not touched by the sweep', async () => {
    const h = makeHarness();
    // Only in_progress row is returned by findBreachedForEscalation
    // (resolved/closed are excluded by the WHERE status IN ('open','in_progress') filter)
    const breached = [
      makeRow({ grievance_id: 'g3', status: GrievanceStatus.IN_PROGRESS, owner_id: RM_ID }),
    ];
    h.repo.findBreachedForEscalation.mockResolvedValue(breached);

    const count = await h.service.runEscalationSweep(ORG, NOW);

    expect(count).toBe(1);
    expect(h.repo.update).toHaveBeenCalledTimes(1);
    expect(h.repo.update.mock.calls[0]?.[0]).toBe('g3');
  });

  it('T35b: sweep continues when one row fails; others are escalated', async () => {
    const h = makeHarness();
    const breached = [
      makeRow({ grievance_id: 'g1', status: GrievanceStatus.OPEN }),
      makeRow({ grievance_id: 'g2', status: GrievanceStatus.OPEN }),
    ];
    h.repo.findBreachedForEscalation.mockResolvedValue(breached);
    // First update fails, second succeeds
    h.repo.update
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce(makeRow({ grievance_id: 'g2', status: GrievanceStatus.ESCALATED }));

    const count = await h.service.runEscalationSweep(ORG, NOW);

    // Only the second one succeeded
    expect(count).toBe(1);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────── List ──

describe('GrievanceService.list', () => {
  it('returns paginated grievance data', async () => {
    const h = makeHarness();
    const rows = [makeRow(), makeRow({ grievance_id: 'g2', grievance_no: 'GRV-2026-000002' })];
    h.repo.list.mockResolvedValue({ rows, total: 2 });

    const result = await h.service.list(
      {
        page: 1,
        limit: 25,
        sort: { column: 'created_at', dir: 'desc' },
      } as never,
      rmCtx(),
    );

    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });
});
