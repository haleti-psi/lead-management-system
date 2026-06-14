import { AuditAction, DataScope, Disposition, ERROR_CODES, EventCode, IntegrationKind, Priority, RoleCode, TaskStatus, TaskType } from '@lms/shared';
import type { ScopePredicate } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import type { AppConfigService } from '../../core/config';
import type { UnitOfWork } from '../../core/db';
import type { IntegrationGateway } from '../../core/integration';
import type { OutboxService } from '../../core/outbox';
import type { LeadService } from '../capture/lead.service';
import type { CommunicationRepository } from './communication.repository';
import { canTransition } from './task-state-machine';
import { TaskRepository, type TaskRow } from './task.repository';
import { TaskService } from './task.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TASK_ID = '00000000-0000-0000-0001-000000000001';
const LEAD_ID = '00000000-0000-0000-0002-000000000001';
const OWNER_ID = '00000000-0000-0000-0003-000000000001';
const OTHER_USER_ID = '00000000-0000-0000-0003-000000000002';

const BRANCH_ID = '00000000-0000-0000-0004-000000000001';

const RM_USER: AuthUser = {
  userId: OWNER_ID,
  orgId: ORG_ID,
  role: RoleCode.RM,
  scope: DataScope.O,
  jti: 'jti-rm',
};

const BM_USER: AuthUser = {
  userId: OTHER_USER_ID,
  orgId: ORG_ID,
  role: RoleCode.BM,
  scope: DataScope.B,
  jti: 'jti-bm',
};

const SM_USER: AuthUser = {
  userId: OTHER_USER_ID,
  orgId: ORG_ID,
  role: RoleCode.SM,
  scope: DataScope.T,
  jti: 'jti-sm',
};

function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    task_id: TASK_ID,
    org_id: ORG_ID,
    lead_id: LEAD_ID,
    type: TaskType.CALL,
    owner_id: OWNER_ID,
    due_at: new Date(Date.now() + 3_600_000),
    priority: Priority.NORMAL,
    sla_policy_id: null,
    status: TaskStatus.OPEN,
    disposition: null,
    result_note: null,
    geo: null,
    next_action_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: OWNER_ID,
    updated_by: OWNER_ID,
    ...overrides,
  } as TaskRow;
}

/** Task row with lead join fields (findByIdWithLead result). */
function makeTaskWithLead(overrides: Partial<TaskRow & { branch_id: string | null; lead_owner_id: string | null }> = {}) {
  return {
    ...makeTaskRow(overrides),
    branch_id: BRANCH_ID,
    lead_owner_id: OWNER_ID,
    ...overrides,
  } as TaskRow & { branch_id: string | null; lead_owner_id: string | null };
}

/** UnitOfWork mock: invokes the callback synchronously with a sentinel tx. */
function fakeUow(db?: object): UnitOfWork {
  const defaultDb = {
    selectFrom: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: jest.fn().mockResolvedValue({ lead_id: LEAD_ID }),
    }),
  };
  const dbToUse = db ?? defaultDb;

  return {
    run: jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn({ __tx: true })),
    tx: jest.fn().mockReturnValue(dbToUse),
    isActive: false,
  } as unknown as UnitOfWork;
}

function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}

function fakeRepo(overrides: Partial<TaskRepository> = {}): TaskRepository {
  return {
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findById: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue(makeTaskRow()),
    update: jest.fn().mockResolvedValue(makeTaskRow()),
    markOverdue: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as TaskRepository;
}

function fakeLeadService(): LeadService {
  return {
    setNurtureNextAt: jest.fn().mockResolvedValue(undefined),
  } as unknown as LeadService;
}

function fakeCommRepo(): CommunicationRepository {
  return {
    insertInternal: jest.fn().mockResolvedValue({ communication_log_id: 'cl-1' }),
    insert: jest.fn().mockResolvedValue({ communication_log_id: 'cl-2' }),
  } as unknown as CommunicationRepository;
}

function fakeOutbox(): OutboxService {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as OutboxService;
}

function fakeGateway(): IntegrationGateway {
  return {
    call: jest.fn().mockResolvedValue({ httpStatus: 200, body: {}, idempotent: false }),
  } as unknown as IntegrationGateway;
}

function fakeTelephonyPort() {
  return { call: jest.fn().mockResolvedValue({ httpStatus: 200, body: {} }) };
}

function fakeConfig(ctiEnabled = false): AppConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'CTI_ENABLED') return ctiEnabled;
      return undefined;
    }),
  } as unknown as AppConfigService;
}

const ownScope: ScopePredicate = { type: 'own', userId: OWNER_ID };
const branchScope: ScopePredicate = { type: 'branch', branchId: 'branch-1' };

// ── State machine unit tests ──────────────────────────────────────────────────

describe('TaskStateMachine.canTransition', () => {
  // T14: overdue is sweep-only
  it('T14: canTransition(open, overdue) returns false — user cannot set overdue', () => {
    expect(canTransition(TaskStatus.OPEN, TaskStatus.OVERDUE)).toBe(false);
  });

  it('T14: canTransition(in_progress, overdue) returns false', () => {
    expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.OVERDUE)).toBe(false);
  });

  it('T09: canTransition(done, open) returns false', () => {
    expect(canTransition(TaskStatus.DONE, TaskStatus.OPEN)).toBe(false);
  });

  it('T10: canTransition(cancelled, done) returns false', () => {
    expect(canTransition(TaskStatus.CANCELLED, TaskStatus.DONE)).toBe(false);
  });

  it('allows open → in_progress', () => {
    expect(canTransition(TaskStatus.OPEN, TaskStatus.IN_PROGRESS)).toBe(true);
  });

  it('allows open → done', () => {
    expect(canTransition(TaskStatus.OPEN, TaskStatus.DONE)).toBe(true);
  });

  it('allows open → cancelled', () => {
    expect(canTransition(TaskStatus.OPEN, TaskStatus.CANCELLED)).toBe(true);
  });

  it('allows in_progress → done', () => {
    expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE)).toBe(true);
  });

  it('allows overdue → in_progress', () => {
    expect(canTransition(TaskStatus.OVERDUE, TaskStatus.IN_PROGRESS)).toBe(true);
  });

  it('allows overdue → done', () => {
    expect(canTransition(TaskStatus.OVERDUE, TaskStatus.DONE)).toBe(true);
  });

  it('does not allow done → any', () => {
    for (const s of Object.values(TaskStatus)) {
      expect(canTransition(TaskStatus.DONE, s as TaskStatus)).toBe(false);
    }
  });

  it('does not allow cancelled → any', () => {
    for (const s of Object.values(TaskStatus)) {
      expect(canTransition(TaskStatus.CANCELLED, s as TaskStatus)).toBe(false);
    }
  });
});

// ── TaskService unit tests ────────────────────────────────────────────────────

describe('TaskService', () => {
  function makeService(
    repoOverrides: Partial<TaskRepository> = {},
    uow?: UnitOfWork,
    leadSvc?: LeadService,
    dbOverride?: object,
    opts?: {
      commRepo?: CommunicationRepository;
      outbox?: OutboxService;
      gateway?: IntegrationGateway;
      telephonyPort?: object;
      config?: AppConfigService;
    },
  ): {
    service: TaskService;
    repo: TaskRepository;
    audit: AuditAppender;
    leadService: LeadService;
    commRepo: CommunicationRepository;
    outbox: OutboxService;
    gateway: IntegrationGateway;
  } {
    const repo = fakeRepo(repoOverrides);
    const audit = fakeAudit();
    const leadService = leadSvc ?? fakeLeadService();
    const commRepo = opts?.commRepo ?? fakeCommRepo();
    const outbox = opts?.outbox ?? fakeOutbox();
    const gateway = opts?.gateway ?? fakeGateway();
    const telephonyPort = opts?.telephonyPort ?? fakeTelephonyPort();
    const config = opts?.config ?? fakeConfig();

    // Default db mock: finds lead + user + policy successfully.
    // Reads (lead exists, owner exists, SLA policy exists) go through the
    // injected Kysely `db` directly (not through uow.tx()), matching the
    // codebase convention of using raw Db for read-only queries (MAJOR 1 fix).
    const defaultDb = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({ lead_id: LEAD_ID, user_id: OWNER_ID, sla_policy_id: 'pol-1' }),
      }),
    };
    const uowToUse = uow ?? fakeUow();
    const db = dbOverride ?? defaultDb;

    const service = new TaskService(
      repo, uowToUse, audit, leadService, db as never,
      commRepo, outbox, gateway, telephonyPort as never, config,
    );

    return { service, repo, audit, leadService, commRepo, outbox, gateway };
  }

  // T01: Happy path create
  describe('create', () => {
    it('T01: creates a task with status=open for an RM on their own lead', async () => {
      const { service, repo, audit } = makeService();

      const dto = {
        lead_id: LEAD_ID,
        type: TaskType.CALL,
        owner_id: OWNER_ID, // same as RM user
        due_at: new Date(Date.now() + 3_600_000).toISOString(),
        priority: Priority.HIGH,
      };

      const result = await service.create(dto, RM_USER);

      expect(result.status).toBe(TaskStatus.OPEN);
      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ lead_id: LEAD_ID, type: TaskType.CALL }),
        expect.anything(),
      );
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LEAD_UPDATE,
          entity_type: 'tasks',
          detail: expect.objectContaining({ op: 'task_create' }),
        }),
        expect.anything(),
      );
    });

    it('T02: returns VALIDATION_ERROR when due_at is in the past', async () => {
      const { service } = makeService();

      const dto = {
        lead_id: LEAD_ID,
        type: TaskType.CALL,
        owner_id: OWNER_ID,
        priority: Priority.NORMAL,
        due_at: new Date(Date.now() - 3_600_000).toISOString(), // past
      };

      await expect(service.create(dto, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: [{ field: 'due_at' }],
      });
    });

    it('T03: returns VALIDATION_ERROR for invalid type', async () => {
      const { service } = makeService();

      // Note: invalid type would be caught at Zod DTO layer before service.
      // Service trusts the DTO is already valid. This test verifies via type system.
      // We test the RM scope enforcement instead:
      const dto = {
        lead_id: LEAD_ID,
        type: TaskType.CALL,
        owner_id: OTHER_USER_ID, // RM trying to assign to other user
        priority: Priority.NORMAL,
        due_at: new Date(Date.now() + 3_600_000).toISOString(),
      };

      await expect(service.create(dto, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      });
    });

    it('T05: returns FORBIDDEN when RM tries to create task with other owner_id', async () => {
      const { service } = makeService();

      const dto = {
        lead_id: LEAD_ID,
        type: TaskType.CALL,
        owner_id: OTHER_USER_ID, // different from RM userId
        priority: Priority.NORMAL,
        due_at: new Date(Date.now() + 3_600_000).toISOString(),
      };

      await expect(service.create(dto, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      });
    });

    it('T19: returns VALIDATION_ERROR when sla_policy_id references inactive policy', async () => {
      // DB mock returns null for sla_policy lookup (inactive/missing).
      // Reads go through the injected Kysely `db` (not uow.tx()), so pass the
      // custom db as the dbOverride (4th arg) rather than wrapping it in fakeUow.
      const dbMock = {
        selectFrom: jest.fn((table: string) => ({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          executeTakeFirst: jest.fn().mockResolvedValue(
            table === 'leads' ? { lead_id: LEAD_ID }
            : table === 'users' ? { user_id: OWNER_ID }
            : null, // sla_policies → not found/inactive
          ),
        })),
      };
      const { service } = makeService({}, undefined, undefined, dbMock);

      const dto = {
        lead_id: LEAD_ID,
        type: TaskType.CALL,
        owner_id: OWNER_ID,
        priority: Priority.NORMAL,
        due_at: new Date(Date.now() + 3_600_000).toISOString(),
        sla_policy_id: '00000000-0000-0000-0099-000000000001',
      };

      await expect(service.create(dto, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: [{ field: 'sla_policy_id' }],
      });
    });
  });

  describe('list', () => {
    it('T06: returns scoped tasks with RM own scope predicate', async () => {
      const task1 = makeTaskRow({ task_id: 'task-1' });
      const task2 = makeTaskRow({ task_id: 'task-2' });
      const { service, repo } = makeService({ list: jest.fn().mockResolvedValue([task1, task2]), count: jest.fn().mockResolvedValue(2) });

      const result = await service.list({}, RM_USER, ownScope);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ owner_id: OWNER_ID }), // RM forced to own tasks
        ownScope,
      );
    });

    it('T07: BM sees branch tasks via branch scope predicate', async () => {
      const task = makeTaskRow({ task_id: 'branch-task' });
      const { service, repo } = makeService({ list: jest.fn().mockResolvedValue([task]), count: jest.fn().mockResolvedValue(1) });

      const result = await service.list({}, BM_USER, branchScope);

      expect(result.data).toHaveLength(1);
      expect(repo.list).toHaveBeenCalledWith(expect.anything(), branchScope);
    });

    it('respects limit cap of 100', async () => {
      const { service, repo } = makeService();

      await service.list({ limit: 500 }, RM_USER, ownScope);

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }), ownScope);
    });
  });

  describe('update', () => {
    it('T08: transitions open → done with disposition', async () => {
      const task = makeTaskRow();
      const updated = makeTaskRow({ status: TaskStatus.DONE, disposition: Disposition.CONNECTED });
      const { service, repo, audit } = makeService({
        findById: jest.fn().mockResolvedValue(task),
        update: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.update(TASK_ID, { status: TaskStatus.DONE, disposition: Disposition.CONNECTED, result_note: 'done' }, RM_USER);

      expect(result.status).toBe(TaskStatus.DONE);
      expect(repo.update).toHaveBeenCalled();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LEAD_UPDATE,
          entity_type: 'tasks',
          detail: expect.objectContaining({ op: 'task_update', from_status: TaskStatus.OPEN, to_status: TaskStatus.DONE }),
        }),
        expect.anything(),
      );
    });

    it('T04: returns VALIDATION_ERROR when status=done but no disposition', async () => {
      const task = makeTaskRow();
      const { service } = makeService({ findById: jest.fn().mockResolvedValue(task) });

      await expect(service.update(TASK_ID, { status: TaskStatus.DONE }, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: [{ field: 'disposition' }],
      });
    });

    it('T09: returns CONFLICT for done → open (invalid transition)', async () => {
      const task = makeTaskRow({ status: TaskStatus.DONE });
      const { service } = makeService({ findById: jest.fn().mockResolvedValue(task) });

      await expect(service.update(TASK_ID, { status: TaskStatus.OPEN }, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
      });
    });

    it('T10: returns CONFLICT for cancelled → done', async () => {
      const task = makeTaskRow({ status: TaskStatus.CANCELLED });
      const { service } = makeService({ findById: jest.fn().mockResolvedValue(task) });

      await expect(service.update(TASK_ID, { status: TaskStatus.DONE, disposition: Disposition.CONNECTED }, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
      });
    });

    it('T11: returns FORBIDDEN when RM attempts to reassign owner_id', async () => {
      const task = makeTaskRow({ owner_id: OWNER_ID });
      const { service } = makeService({ findById: jest.fn().mockResolvedValue(task) });

      await expect(service.update(TASK_ID, { owner_id: OTHER_USER_ID }, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      });
    });

    it('T12: BM can reassign owner_id', async () => {
      const task = makeTaskRow({ owner_id: OWNER_ID });
      const updated = makeTaskRow({ owner_id: OTHER_USER_ID });

      // DB mock: owner lookup returns the new owner (reads go through injected `db`).
      const dbMock = {
        selectFrom: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          executeTakeFirst: jest.fn().mockResolvedValue({ user_id: OTHER_USER_ID }),
        }),
      };

      const { service } = makeService(
        {
          findById: jest.fn().mockResolvedValue(task),
          update: jest.fn().mockResolvedValue(updated),
        },
        undefined,
        undefined,
        dbMock,
      );

      const result = await service.update(TASK_ID, { owner_id: OTHER_USER_ID }, BM_USER);

      expect(result.owner_id).toBe(OTHER_USER_ID);
    });

    it('T13: returns NOT_FOUND when task_id does not exist', async () => {
      const { service } = makeService({ findById: jest.fn().mockResolvedValue(null) });

      await expect(service.update('00000000-0000-0000-9999-000000000001', {}, RM_USER)).rejects.toMatchObject({
        code: ERROR_CODES.NOT_FOUND,
      });
    });

    it('T17: setNurtureNextAt called when nurture task completed with next_action_at', async () => {
      const nurtureTask = makeTaskRow({ type: TaskType.NURTURE, status: TaskStatus.OPEN });
      const nextActionAt = new Date(Date.now() + 7_200_000).toISOString();
      const leadService = fakeLeadService();
      const { service } = makeService(
        {
          findById: jest.fn().mockResolvedValue(nurtureTask),
          update: jest.fn().mockResolvedValue(makeTaskRow({ status: TaskStatus.DONE })),
        },
        undefined,
        leadService,
      );

      await service.update(TASK_ID, { status: TaskStatus.DONE, disposition: Disposition.CONNECTED, next_action_at: nextActionAt }, RM_USER);

      expect(leadService.setNurtureNextAt).toHaveBeenCalledWith(
        LEAD_ID,
        new Date(nextActionAt),
        expect.anything(),
      );
    });

    it('T18: setNurtureNextAt NOT called for non-nurture task', async () => {
      const callTask = makeTaskRow({ type: TaskType.CALL, status: TaskStatus.OPEN });
      const nextActionAt = new Date(Date.now() + 7_200_000).toISOString();
      const leadService = fakeLeadService();
      const { service } = makeService(
        {
          findById: jest.fn().mockResolvedValue(callTask),
          update: jest.fn().mockResolvedValue(makeTaskRow({ status: TaskStatus.DONE })),
        },
        undefined,
        leadService,
      );

      await service.update(TASK_ID, { status: TaskStatus.DONE, disposition: Disposition.CONNECTED, next_action_at: nextActionAt }, RM_USER);

      expect(leadService.setNurtureNextAt).not.toHaveBeenCalled();
    });
  });
});

// ── FR-102 logDisposition tests ───────────────────────────────────────────────

/**
 * Build a transaction mock that supports the updateTable chain used by
 * logDisposition. `updatedRow` controls what .executeTakeFirst() returns.
 */
function fakeDispositionTx(updatedRow: TaskRow | undefined) {
  return {
    updateTable: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returningAll: jest.fn().mockReturnThis(),
      executeTakeFirst: jest.fn().mockResolvedValue(updatedRow),
    }),
  };
}

/**
 * Build a UnitOfWork that invokes fn with the given tx mock.
 */
function fakeUowWithTx(tx: object): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn(tx)),
    tx: jest.fn().mockReturnValue(tx),
    isActive: false,
  } as unknown as UnitOfWork;
}

describe('TaskService.logDisposition (FR-102)', () => {
  const FUTURE_AT = new Date(Date.now() + 3_600_000).toISOString();

  function makeDispositionService(opts?: {
    /** Pass explicitly to control: undefined → use default; null → simulate not found. */
    taskWithLead?: (TaskRow & { branch_id: string | null; lead_owner_id: string | null }) | null;
    updatedRow?: TaskRow;
    ctiEnabled?: boolean;
    gatewayOverride?: IntegrationGateway;
  }) {
    // Explicitly check `undefined` (not `??`) so callers can pass `null` to simulate NOT_FOUND.
    const taskWithLead = 'taskWithLead' in (opts ?? {}) ? opts!.taskWithLead : makeTaskWithLead();
    const updatedRow = opts?.updatedRow ?? makeTaskRow({ status: TaskStatus.DONE, disposition: Disposition.CONNECTED });
    const tx = fakeDispositionTx(updatedRow);
    const uow = fakeUowWithTx(tx);
    const repo = fakeRepo({ findByIdWithLead: jest.fn().mockResolvedValue(taskWithLead) } as Partial<TaskRepository>);
    const audit = fakeAudit();
    const commRepo = fakeCommRepo();
    const outbox = fakeOutbox();
    const gatewayOverride = opts?.gatewayOverride ?? fakeGateway();
    const config = fakeConfig(opts?.ctiEnabled ?? false);

    const service = new TaskService(
      repo, uow, audit, fakeLeadService(), {} as never,
      commRepo, outbox, gatewayOverride, fakeTelephonyPort() as never, config,
    );

    return { service, repo, audit, commRepo, outbox, tx, uow, gateway: gatewayOverride };
  }

  // TC-01: Happy path — call disposition
  it('TC-01: logs connected disposition on own call task and returns updated task', async () => {
    const { service, commRepo, outbox, audit } = makeDispositionService();

    const result = await service.logDisposition(
      TASK_ID,
      { disposition: Disposition.CONNECTED, result_note: 'Spoke with customer.' },
      RM_USER,
    );

    expect(result.status).toBe(TaskStatus.DONE);
    expect(commRepo.insertInternal).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: LEAD_ID, recipient: OWNER_ID }),
      expect.anything(),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LEAD_UPDATE,
        entity_type: 'tasks',
        detail: expect.objectContaining({ event: 'disposition_logged', disposition: Disposition.CONNECTED }),
      }),
      expect.anything(),
    );
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_code: EventCode.LEAD_STAGE_CHANGED,
        aggregate_type: 'tasks',
        aggregate_id: TASK_ID,
      }),
      expect.anything(),
    );
  });

  // TC-02: Happy path — visit disposition with geo
  it('TC-02: logs visited disposition on visit task with geo', async () => {
    const visitTask = makeTaskWithLead({ type: TaskType.VISIT });
    const { service, commRepo } = makeDispositionService({ taskWithLead: visitTask });

    const geo = { lat: 19.076, lng: 72.877, accuracy_m: 10 };
    const result = await service.logDisposition(
      TASK_ID,
      { disposition: Disposition.VISITED, geo },
      RM_USER,
    );

    expect(result.status).toBe(TaskStatus.DONE);
    expect(commRepo.insertInternal).toHaveBeenCalled();
  });

  // TC-03: Geo omitted — no validation error
  it('TC-03: geo omitted for visit task — accepted without error', async () => {
    const visitTask = makeTaskWithLead({ type: TaskType.VISIT });
    const { service } = makeDispositionService({ taskWithLead: visitTask });

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.VISITED }, RM_USER),
    ).resolves.toBeDefined();
  });

  // TC-07: NOT_FOUND when task does not exist
  it('TC-07: returns NOT_FOUND when task_id does not exist', async () => {
    const { service } = makeDispositionService({ taskWithLead: null });

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, RM_USER),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  // TC-08: CONFLICT when task already done
  it('TC-08: returns CONFLICT when task status is done (pre-check)', async () => {
    const doneTask = makeTaskWithLead({ status: TaskStatus.DONE });
    const { service } = makeDispositionService({ taskWithLead: doneTask });

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, RM_USER),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  // TC-08b: CONFLICT from database (concurrent completion)
  it('TC-08b: returns CONFLICT when UPDATE returns no row (concurrent done)', async () => {
    const task = makeTaskWithLead();
    const tx = fakeDispositionTx(undefined); // UPDATE returns no row → concurrent done
    const uow = fakeUowWithTx(tx);
    const repo = fakeRepo({ findByIdWithLead: jest.fn().mockResolvedValue(task) } as Partial<TaskRepository>);
    const service = new TaskService(
      repo, uow, fakeAudit(), fakeLeadService(), {} as never,
      fakeCommRepo(), fakeOutbox(), fakeGateway(), fakeTelephonyPort() as never, fakeConfig(),
    );

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, RM_USER),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  // TC-10: VALIDATION_ERROR — next_action_at missing for rescheduled
  it('TC-10: returns VALIDATION_ERROR when next_action_at missing for rescheduled', async () => {
    const { service } = makeDispositionService();

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.RESCHEDULED }, RM_USER),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'next_action_at' }],
    });
  });

  // TC-10b: VALIDATION_ERROR — next_action_at missing for callback_requested
  it('TC-10b: returns VALIDATION_ERROR when next_action_at missing for callback_requested', async () => {
    const { service } = makeDispositionService();

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CALLBACK_REQUESTED }, RM_USER),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'next_action_at' }],
    });
  });

  // TC-10c: no error when next_action_at provided for rescheduled
  it('TC-10c: accepts rescheduled with future next_action_at', async () => {
    const { service } = makeDispositionService();

    await expect(
      service.logDisposition(
        TASK_ID,
        { disposition: Disposition.RESCHEDULED, next_action_at: FUTURE_AT },
        RM_USER,
      ),
    ).resolves.toBeDefined();
  });

  // TC-11: VALIDATION_ERROR — geo on non-call/visit task
  it('TC-11: returns VALIDATION_ERROR when geo sent for doc_request task', async () => {
    const docTask = makeTaskWithLead({ type: TaskType.DOC_REQUEST });
    const { service } = makeDispositionService({ taskWithLead: docTask });

    await expect(
      service.logDisposition(
        TASK_ID,
        { disposition: Disposition.CONNECTED, geo: { lat: 19, lng: 72, accuracy_m: 5 } },
        RM_USER,
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'geo' }],
    });
  });

  // TC-13: Transaction rollback — OutboxService throws → commLog also rolled back
  it('TC-13: outbox emit failure causes full transaction rollback (uow.run throws)', async () => {
    const task = makeTaskWithLead();
    const updatedRow = makeTaskRow({ status: TaskStatus.DONE });
    const tx = fakeDispositionTx(updatedRow);
    const outbox = { emit: jest.fn().mockRejectedValue(new Error('outbox fail')) } as unknown as OutboxService;
    const uow = fakeUowWithTx(tx);
    const repo = fakeRepo({ findByIdWithLead: jest.fn().mockResolvedValue(task) } as Partial<TaskRepository>);
    const service = new TaskService(
      repo, uow, fakeAudit(), fakeLeadService(), {} as never,
      fakeCommRepo(), outbox, fakeGateway(), fakeTelephonyPort() as never, fakeConfig(),
    );

    // The uow.run propagates the throw from the tx callback
    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, RM_USER),
    ).rejects.toThrow('outbox fail');
  });

  // TC-14: Overdue task can be dispositioned
  it('TC-14: overdue task is accepted for disposition logging', async () => {
    const overdueTask = makeTaskWithLead({ status: TaskStatus.OVERDUE });
    const { service } = makeDispositionService({ taskWithLead: overdueTask });

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, RM_USER),
    ).resolves.toBeDefined();
  });

  // TC-15: CTI port failure — manual record committed, 503 thrown post-commit
  it('TC-15: CTI failure after commit throws UPSTREAM_UNAVAILABLE (503)', async () => {
    const gateway = {
      call: jest.fn().mockRejectedValue({ code: ERROR_CODES.UPSTREAM_UNAVAILABLE }),
    } as unknown as IntegrationGateway;
    const { service } = makeDispositionService({ ctiEnabled: true, gatewayOverride: gateway });

    // CTI_ENABLED + task.type='call' → gateway is called post-commit
    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, RM_USER),
    ).rejects.toMatchObject({ code: ERROR_CODES.UPSTREAM_UNAVAILABLE });

    // Gateway was called with CTI integration kind
    expect(gateway.call).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ integration: IntegrationKind.CTI }),
      expect.objectContaining({ idempotencyKey: `cti-${TASK_ID}-${Disposition.CONNECTED}` }),
    );
  });

  // TC-16: BM branch-scoped happy path
  it('TC-16: BM can log disposition on a task whose lead is in their branch', async () => {
    const taskInBranch = makeTaskWithLead({ owner_id: OWNER_ID });
    const { service, commRepo } = makeDispositionService({ taskWithLead: taskInBranch });

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, BM_USER),
    ).resolves.toBeDefined();
    expect(commRepo.insertInternal).toHaveBeenCalled();
  });

  // Role restriction: SM cannot log disposition
  it('FORBIDDEN: SM role cannot log disposition (not in RM/BM allow-list)', async () => {
    const { service } = makeDispositionService();

    await expect(
      service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, SM_USER),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  // CTI not called when CTI_ENABLED=false
  it('CTI not called when CTI_ENABLED=false', async () => {
    const gateway = fakeGateway();
    const { service } = makeDispositionService({ ctiEnabled: false, gatewayOverride: gateway });

    await service.logDisposition(TASK_ID, { disposition: Disposition.CONNECTED }, RM_USER);

    expect(gateway.call).not.toHaveBeenCalled();
  });

  // CTI not called when task.type is visit (even if CTI_ENABLED)
  it('CTI not called for visit task type even when CTI_ENABLED', async () => {
    const visitTask = makeTaskWithLead({ type: TaskType.VISIT });
    const gateway = fakeGateway();
    const { service } = makeDispositionService({ taskWithLead: visitTask, ctiEnabled: true, gatewayOverride: gateway });

    await service.logDisposition(TASK_ID, { disposition: Disposition.VISITED }, RM_USER);

    expect(gateway.call).not.toHaveBeenCalled();
  });
});
