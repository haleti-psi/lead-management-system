import { ERROR_CODES } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction } from '../../core/db';
import type { OutboxService } from '../../core/outbox';
import { LeadService, type AssignOwnerInput, type CreateLeadInput } from './lead.service';

/**
 * FR-010 unit tests for {@link LeadService} — the sole writer of `leads`
 * (architecture §11.2): entry-state create (INV-01/INV-10 structural analogue),
 * optimistic-lock semantics of setSlaDueAt/setScore (stale → CONFLICT), the
 * idempotent assignOwner with audit+outbox in the same tx (LeadSlaWriterPort
 * contract), the LIMIT-bounded bulkReassign with one audit per lead
 * (CORRECTIONS.md §FR-130), and the loud not-yet-wired stubs.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';

function fakeAudit(): { append: jest.Mock } {
  return { append: jest.fn().mockResolvedValue(undefined) };
}

function fakeOutbox(): { emit: jest.Mock } {
  return { emit: jest.fn().mockResolvedValue(undefined) };
}

function createInput(overrides: Partial<CreateLeadInput> = {}): CreateLeadInput {
  return {
    org_id: ORG,
    lead_code: 'LD-2026-000123',
    product_code: 'CV',
    product_config_id: 'pc-1',
    branch_id: null,
    pin_code: null,
    owner_id: null,
    source_attribution_id: 'sa-1',
    customer_profile_id: 'cp-1',
    lead_identity_id: 'li-1',
    channel_created_by: 'manual',
    consent_status: 'partial',
    duplicate_status: 'none',
    kyc_status: 'not_started',
    requested_amount: null,
    import_job_id: null,
    created_by: 'actor-1',
    ...overrides,
  };
}

/** Chainable Kysely tx fake; terminal mocks injected per test. */
interface TxFake {
  tx: DbTransaction;
  insertValues: jest.Mock;
  updateSet: jest.Mock;
  whereCalls: jest.Mock;
  executeTakeFirst: jest.Mock;
  executeTakeFirstOrThrow: jest.Mock;
  execute: jest.Mock;
  selectRow: jest.Mock;
}

function makeTx(opts: {
  selectedRow?: unknown;
  updatedRows?: bigint;
  /** Row the UPDATE…RETURNING path resolves (assignOwner); undefined = 0 rows → CONFLICT. */
  updatedRow?: unknown;
  insertedRow?: unknown;
  returningRows?: unknown[];
} = {}): TxFake {
  const insertValues = jest.fn();
  const updateSet = jest.fn();
  const whereCalls = jest.fn();
  const executeTakeFirst = jest.fn(async () =>
    'updatedRow' in opts ? opts.updatedRow : { numUpdatedRows: opts.updatedRows ?? 1n },
  );
  const executeTakeFirstOrThrow = jest.fn(async () => opts.insertedRow ?? { lead_id: LEAD });
  const execute = jest.fn(async () => opts.returningRows ?? []);
  const selectRow = jest.fn(async () => opts.selectedRow);

  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain['values'] = jest.fn((v: unknown) => {
    insertValues(v);
    return chain;
  });
  chain['set'] = jest.fn((v: unknown) => {
    updateSet(v);
    return chain;
  });
  for (const m of ['insertInto', 'updateTable', 'returning', 'orderBy', 'limit']) {
    chain[m] = jest.fn(self);
  }
  chain['where'] = jest.fn((...args: unknown[]) => {
    whereCalls(...args);
    return chain;
  });
  // selectFrom path terminates in executeTakeFirst returning the selected row;
  // update paths terminate in executeTakeFirst returning numUpdatedRows.
  let selecting = false;
  chain['selectFrom'] = jest.fn(() => {
    selecting = true;
    return chain;
  });
  chain['select'] = jest.fn(self);
  chain['executeTakeFirst'] = jest.fn(async () => {
    if (selecting) {
      selecting = false;
      return selectRow();
    }
    return executeTakeFirst();
  });
  chain['executeTakeFirstOrThrow'] = executeTakeFirstOrThrow;
  chain['execute'] = execute;

  return {
    tx: chain as unknown as DbTransaction,
    insertValues,
    updateSet,
    whereCalls,
    executeTakeFirst,
    executeTakeFirstOrThrow,
    execute,
    selectRow,
  };
}

describe('LeadService.create', () => {
  it('inserts the lead at stage=captured with version=1 (INV-01/INV-10)', async () => {
    const t = makeTx();
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    const result = await service.create(createInput(), t.tx);

    expect(result).toEqual({ lead_id: LEAD });
    expect(t.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'captured',
        version: 1,
        priority: 'normal',
        lead_code: 'LD-2026-000123',
        created_by: 'actor-1',
        updated_by: 'actor-1',
      }),
    );
  });
});

describe('LeadService.appendStageHistory', () => {
  it('appends from_stage=null → captured for initial capture (INV-02)', async () => {
    const t = makeTx();
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    await service.appendStageHistory(
      { org_id: ORG, lead_id: LEAD, from_stage: null, to_stage: 'captured', actor_id: 'actor-1', reason: 'Initial capture' },
      t.tx,
    );
    expect(t.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ from_stage: null, to_stage: 'captured', lead_id: LEAD }),
    );
  });
});

describe('LeadService.setSlaDueAt', () => {
  it('updates under WHERE version = expectedVersion and bumps the version', async () => {
    const t = makeTx({ updatedRows: 1n });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    const dueAt = new Date('2026-06-15T09:00:00Z');

    await service.setSlaDueAt(LEAD, dueAt, 3, t.tx);

    expect(t.whereCalls).toHaveBeenCalledWith('version', '=', 3);
    // The set callback bumps version via eb('version', '+', 1).
    const setFn = t.updateSet.mock.calls[0]?.[0] as (eb: jest.Mock) => Record<string, unknown>;
    const eb = jest.fn(() => 'version+1');
    const patch = setFn(eb);
    expect(patch['sla_first_contact_due_at']).toBe(dueAt);
    expect(eb).toHaveBeenCalledWith('version', '+', 1);
  });

  it('throws CONFLICT when the expectedVersion is stale', async () => {
    const t = makeTx({ updatedRows: 0n });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.setSlaDueAt(LEAD, new Date(), 2, t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });
});

describe('LeadService.setScore', () => {
  it('throws CONFLICT on stale version (optimistic lock)', async () => {
    const t = makeTx({ updatedRows: 0n });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.setScore(LEAD, 80, ['hot amount'], 1, t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });
});

describe('LeadService.recomputeDuplicateStatus (FR-020)', () => {
  function makeService(): LeadService {
    return new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
  }

  it.each([
    ['warned', 'flagged'],
    ['queued', 'flagged'],
    ['blocked', 'flagged'],
    ['linked', 'linked'],
    ['merged', 'merged'],
    ['overridden', 'none'], // an override clears the flag (UI-T02)
  ] as const)(
    'derives %s → duplicate_status=%s from the highest-severity open match',
    async (action, expected) => {
      const t = makeTx({ selectedRow: { action }, updatedRows: 1n });
      const status = await makeService().recomputeDuplicateStatus(LEAD, ORG, 'actor-1', 3, t.tx);

      expect(status).toBe(expected);
      expect(t.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ duplicate_status: expected, updated_by: 'actor-1' }),
      );
      expect(t.whereCalls).toHaveBeenCalledWith('version', '=', 3);
    },
  );

  it('INV-04: with no open matches the status recomputes to none', async () => {
    const t = makeTx({ selectedRow: undefined, updatedRows: 1n });
    await expect(makeService().recomputeDuplicateStatus(LEAD, ORG, 'actor-1', 1, t.tx)).resolves.toBe('none');
  });

  it('does NOT bump the version (derived field — no false 409s for human edits)', async () => {
    const t = makeTx({ selectedRow: { action: 'warned' }, updatedRows: 1n });
    await makeService().recomputeDuplicateStatus(LEAD, ORG, 'actor-1', 3, t.tx);
    const patch = t.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch['version']).toBeUndefined();
  });

  it('T21: throws CONFLICT when the expectedVersion is stale (optimistic lock)', async () => {
    const t = makeTx({ selectedRow: { action: 'warned' }, updatedRows: 0n });
    await expect(makeService().recomputeDuplicateStatus(LEAD, ORG, 'actor-1', 9, t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });
});

describe('LeadService.setConsentStatus (FR-110)', () => {
  it('updates consent_status + updated_at only — org-scoped, no version bump, stage untouched', async () => {
    const t = makeTx({ updatedRows: 1n });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    await service.setConsentStatus(LEAD, 'withdrawn', ORG, t.tx);

    const patch = t.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch['consent_status']).toBe('withdrawn');
    expect(patch['updated_at']).toBeInstanceOf(Date);
    // Volatile system-managed field (FR-110 LLD): no version bump, no stage write.
    expect(Object.keys(patch).sort()).toEqual(['consent_status', 'updated_at']);
    expect(t.whereCalls).toHaveBeenCalledWith('lead_id', '=', LEAD);
    expect(t.whereCalls).toHaveBeenCalledWith('org_id', '=', ORG);
    expect(t.whereCalls).toHaveBeenCalledWith('deleted_at', 'is', null);
    expect(t.whereCalls).not.toHaveBeenCalledWith('version', '=', expect.anything());
  });

  it('throws NOT_FOUND when the lead is absent or soft-deleted (never a silent no-op)', async () => {
    const t = makeTx({ updatedRows: 0n });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.setConsentStatus(LEAD, 'captured', ORG, t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('LeadService.setKycStatus (FR-070)', () => {
  it('updates kyc_status + updated_at only — no version bump, stage untouched', async () => {
    const t = makeTx({ updatedRows: 1n });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    await service.setKycStatus(LEAD, 'verified', t.tx);

    const patch = t.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch['kyc_status']).toBe('verified');
    expect(patch['updated_at']).toBeInstanceOf(Date);
    // Volatile system-managed derived field: no version bump (FR-070 LLD §8).
    expect(Object.keys(patch).sort()).toEqual(['kyc_status', 'updated_at']);
    expect(t.whereCalls).toHaveBeenCalledWith('lead_id', '=', LEAD);
    expect(t.whereCalls).toHaveBeenCalledWith('deleted_at', 'is', null);
    expect(t.whereCalls).not.toHaveBeenCalledWith('version', '=', expect.anything());
  });

  it('throws NOT_FOUND when the lead is absent or soft-deleted (never a silent no-op)', async () => {
    const t = makeTx({ updatedRows: 0n });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.setKycStatus(LEAD, 'verified', t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('LeadService.assignOwner', () => {
  const baseRow = {
    lead_id: LEAD,
    org_id: ORG,
    lead_code: 'LD-2026-000123',
    owner_id: 'owner-old',
    team_id: 'team-1',
    stage: 'assigned',
    version: 2,
  };

  function assignInput(overrides: Partial<AssignOwnerInput> = {}): AssignOwnerInput {
    return {
      ownerId: 'owner-new',
      teamId: 'team-2',
      reason: 'Customer requested language-match RM',
      method: 'manual',
      actorId: 'actor-bm',
      expectedVersion: 2,
      ...overrides,
    };
  }

  it('skips the write when the owner already owns the assigned lead (idempotent — SLA port contract)', async () => {
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const t = makeTx({ selectedRow: { ...baseRow, owner_id: 'owner-1' } });
    const service = new LeadService(audit as unknown as AuditAppender, outbox as unknown as OutboxService);

    const result = await service.assignOwner(LEAD, assignInput({ ownerId: 'owner-1' }), t.tx);

    expect(result).toEqual({ lead_id: LEAD, owner_id: 'owner-1', team_id: 'team-1', stage: 'assigned', version: 2 });
    expect(t.updateSet).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it('updates owner under WHERE version=expectedVersion and emits audit(reassign) + LEAD_ASSIGNED in the same tx', async () => {
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const t = makeTx({
      selectedRow: baseRow,
      updatedRow: { lead_id: LEAD, owner_id: 'owner-new', team_id: 'team-2', stage: 'assigned', version: 3 },
    });
    const service = new LeadService(audit as unknown as AuditAppender, outbox as unknown as OutboxService);

    const result = await service.assignOwner(LEAD, assignInput({ detail: { override_capacity: true } }), t.tx);

    expect(result).toEqual({ lead_id: LEAD, owner_id: 'owner-new', team_id: 'team-2', stage: 'assigned', version: 3 });
    expect(t.whereCalls).toHaveBeenCalledWith('version', '=', 2);
    // Already-assigned lead: owner changes, stage stays — NO stage_history row (INV-02).
    expect(t.insertValues).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reassign',
        entity_type: 'leads',
        actor_id: 'actor-bm',
        lead_id: LEAD,
        detail: expect.objectContaining({
          previous_owner_id: 'owner-old',
          new_owner_id: 'owner-new',
          method: 'manual',
          override_capacity: true,
        }),
      }),
      t.tx,
    );
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_code: 'LEAD_ASSIGNED',
        aggregate_type: 'leads',
        aggregate_id: LEAD,
        payload: expect.objectContaining({ owner_id: 'owner-new', team_id: 'team-2' }),
      }),
      t.tx,
    );
  });

  it('regression: reassign at stage=qualified moves the owner only — stage untouched, NO stage_history; audit + outbox still in the same tx', async () => {
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const t = makeTx({
      selectedRow: { ...baseRow, stage: 'qualified' },
      updatedRow: { lead_id: LEAD, owner_id: 'owner-new', team_id: 'team-2', stage: 'qualified', version: 3 },
    });
    const service = new LeadService(audit as unknown as AuditAppender, outbox as unknown as OutboxService);

    const result = await service.assignOwner(
      LEAD,
      assignInput({ slaFirstContactDueAt: new Date('2026-06-15T09:00:00Z') }),
      t.tx,
    );

    expect(result).toEqual({ lead_id: LEAD, owner_id: 'owner-new', team_id: 'team-2', stage: 'qualified', version: 3 });
    // qualified → assigned is NOT in the state-machine allow-list: the single
    // optimistic-lock UPDATE must not touch stage (or reset the SLA timer)…
    const setFn = t.updateSet.mock.calls[0]?.[0] as (eb: jest.Mock) => Record<string, unknown>;
    const patch = setFn(jest.fn(() => 'version+1'));
    expect(patch['owner_id']).toBe('owner-new');
    expect(patch).not.toHaveProperty('stage');
    expect(patch).not.toHaveProperty('sla_first_contact_due_at');
    // …and NO stage_history row is appended (INV-02).
    expect(t.insertValues).not.toHaveBeenCalled();
    // Audit (actor = the caller) + LEAD_ASSIGNED outbox still land in the same tx.
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reassign',
        actor_id: 'actor-bm',
        lead_id: LEAD,
        detail: expect.objectContaining({ previous_owner_id: 'owner-old', new_owner_id: 'owner-new' }),
      }),
      t.tx,
    );
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_code: 'LEAD_ASSIGNED',
        aggregate_id: LEAD,
        payload: expect.objectContaining({ owner_id: 'owner-new', team_id: 'team-2' }),
      }),
      t.tx,
    );
  });

  it('captured → assigned: sets stage + SLA due in ONE update and appends stage_history (T24/T34 analogue)', async () => {
    const audit = fakeAudit();
    const t = makeTx({
      selectedRow: { ...baseRow, owner_id: null, stage: 'captured', version: 1 },
      updatedRow: { lead_id: LEAD, owner_id: 'owner-new', team_id: 'team-2', stage: 'assigned', version: 2 },
    });
    const service = new LeadService(audit as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    const dueAt = new Date('2026-06-15T09:00:00Z');

    await service.assignOwner(
      LEAD,
      assignInput({ method: 'round_robin', expectedVersion: 1, slaFirstContactDueAt: dueAt }),
      t.tx,
    );

    const setFn = t.updateSet.mock.calls[0]?.[0] as (eb: jest.Mock) => Record<string, unknown>;
    const patch = setFn(jest.fn(() => 'version+1'));
    expect(patch['stage']).toBe('assigned');
    expect(patch['owner_id']).toBe('owner-new');
    expect(patch['team_id']).toBe('team-2');
    expect(patch['sla_first_contact_due_at']).toBe(dueAt);
    // A real transition → stage_history appended in the same tx.
    expect(t.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ from_stage: 'captured', to_stage: 'assigned', lead_id: LEAD, actor_id: 'actor-bm' }),
    );
    // First assignment from a null owner defaults to audit action 'allocate'.
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'allocate' }), t.tx);
  });

  it('dormant → assigned: the other allow-listed entry to assigned — stage set + stage_history appended', async () => {
    const audit = fakeAudit();
    const t = makeTx({
      selectedRow: { ...baseRow, stage: 'dormant' },
      updatedRow: { lead_id: LEAD, owner_id: 'owner-new', team_id: 'team-2', stage: 'assigned', version: 3 },
    });
    const service = new LeadService(audit as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    await service.assignOwner(LEAD, assignInput(), t.tx);

    const setFn = t.updateSet.mock.calls[0]?.[0] as (eb: jest.Mock) => Record<string, unknown>;
    expect(setFn(jest.fn(() => 'version+1'))['stage']).toBe('assigned');
    expect(t.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ from_stage: 'dormant', to_stage: 'assigned', lead_id: LEAD, actor_id: 'actor-bm' }),
    );
  });

  it('honours an explicit auditAction override (manual reassign of a captured lead → reassign, T25)', async () => {
    const audit = fakeAudit();
    const t = makeTx({
      selectedRow: { ...baseRow, owner_id: null, stage: 'captured', version: 1 },
      updatedRow: { lead_id: LEAD, owner_id: 'owner-new', team_id: 'team-2', stage: 'assigned', version: 2 },
    });
    const service = new LeadService(audit as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    await service.assignOwner(LEAD, assignInput({ expectedVersion: 1, auditAction: 'reassign' }), t.tx);

    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'reassign' }), t.tx);
  });

  it('throws NOT_FOUND for a missing/deleted lead', async () => {
    const t = makeTx({ selectedRow: undefined });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.assignOwner(LEAD, assignInput(), t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('throws CONFLICT for a lead in the terminal handed_off stage (T20 analogue)', async () => {
    const t = makeTx({ selectedRow: { ...baseRow, stage: 'handed_off' } });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.assignOwner(LEAD, assignInput(), t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(t.updateSet).not.toHaveBeenCalled();
  });

  it('T09: throws CONFLICT when the optimistic-lock UPDATE matches 0 rows (stale expectedVersion)', async () => {
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const t = makeTx({ selectedRow: baseRow, updatedRow: undefined });
    const service = new LeadService(audit as unknown as AuditAppender, outbox as unknown as OutboxService);

    await expect(service.assignOwner(LEAD, assignInput({ expectedVersion: 1 }), t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    // Nothing else persists from this mutator on conflict (tx rolls back anyway).
    expect(audit.append).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it('unassigned-pool variant (ownerId=null): parks team, keeps stage/owner, emits LEAD_ASSIGNED only (T07/T35 analogue)', async () => {
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const t = makeTx({
      selectedRow: { ...baseRow, owner_id: null, team_id: null, stage: 'captured', version: 1 },
      updatedRow: { team_id: 'team-pool', version: 2 },
    });
    const service = new LeadService(audit as unknown as AuditAppender, outbox as unknown as OutboxService);

    const result = await service.assignOwner(
      LEAD,
      assignInput({ ownerId: null, teamId: 'team-pool', reason: 'unassigned_pool', method: null, expectedVersion: 1 }),
      t.tx,
    );

    expect(result).toEqual({ lead_id: LEAD, owner_id: null, team_id: 'team-pool', stage: 'captured', version: 2 });
    // INV-01/INV-02/INV-08: no stage transition, no stage_history, no audit row.
    expect(t.insertValues).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_code: 'LEAD_ASSIGNED',
        aggregate_id: LEAD,
        payload: expect.objectContaining({ owner_id: null, team_id: 'team-pool', reason: 'unassigned_pool' }),
      }),
      t.tx,
    );
  });

  it('unassigned-pool variant without a pool team: no leads write at all, event still emitted', async () => {
    const outbox = fakeOutbox();
    const t = makeTx({
      selectedRow: { ...baseRow, owner_id: null, team_id: null, stage: 'captured', version: 1 },
    });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, outbox as unknown as OutboxService);

    const result = await service.assignOwner(
      LEAD,
      assignInput({ ownerId: null, teamId: undefined, reason: 'unassigned_pool', method: null, expectedVersion: 1 }),
      t.tx,
    );

    expect(result.version).toBe(1); // no version churn
    expect(t.updateSet).not.toHaveBeenCalled();
    expect(outbox.emit).toHaveBeenCalledTimes(1);
  });
});

describe('LeadService.bulkReassign', () => {
  it('rejects more than 100 lead ids (LIMIT-bounded)', async () => {
    const t = makeTx();
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    const ids = Array.from({ length: 101 }, (_, i) => `lead-${i}`);
    await expect(service.bulkReassign(ids, 'owner-new', 'deactivation', t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
    });
  });

  it('returns 0 without touching the DB for an empty id list', async () => {
    const t = makeTx();
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.bulkReassign([], 'owner-new', 'x', t.tx)).resolves.toBe(0);
    expect(t.updateSet).not.toHaveBeenCalled();
  });

  it('bumps versions and writes ONE audit_logs(reassign) per reassigned lead', async () => {
    const audit = fakeAudit();
    const t = makeTx({
      returningRows: [
        { lead_id: 'lead-1', org_id: ORG },
        { lead_id: 'lead-2', org_id: ORG },
      ],
    });
    const service = new LeadService(audit as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    const count = await service.bulkReassign(['lead-1', 'lead-2', 'lead-3'], 'owner-new', 'deactivation', t.tx);

    // lead-3 was terminal/deleted → not returned → not audited.
    expect(count).toBe(2);
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'reassign', entity_id: 'lead-1', lead_id: 'lead-1' }),
      t.tx,
    );
    // Version bump applied via the set callback.
    const setFn = t.updateSet.mock.calls[0]?.[0] as (eb: jest.Mock) => Record<string, unknown>;
    const eb = jest.fn(() => 'version+1');
    setFn(eb);
    expect(eb).toHaveBeenCalledWith('version', '+', 1);
  });
});

describe('LeadService frozen-interface stubs', () => {
  it.each([
    ['transitionStage', (s: LeadService, tx: DbTransaction) => s.transitionStage(LEAD, 'assigned', {}, 1, tx)],
    ['setHotFlag', (s: LeadService, tx: DbTransaction) => s.setHotFlag(LEAD, true, [], tx)],
    ['recordEligibility', (s: LeadService, tx: DbTransaction) => s.recordEligibility(LEAD, 'snap-1', tx)],
    ['markHandedOff', (s: LeadService, tx: DbTransaction) => s.markHandedOff(LEAD, 'LOS-1', 1, tx)],
    ['merge', (s: LeadService, tx: DbTransaction) => s.merge(LEAD, 'dup-1', 'merge', tx)],
  ] as Array<[string, (s: LeadService, tx: DbTransaction) => Promise<void>]>)(
    '%s throws a typed INTERNAL_ERROR until its FR lands (never a silent no-op)',
    async (_name, call) => {
      const t = makeTx();
      const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
      await expect(call(service, t.tx)).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR });
      expect(t.insertValues).not.toHaveBeenCalled();
      expect(t.updateSet).not.toHaveBeenCalled();
    },
  );
});
