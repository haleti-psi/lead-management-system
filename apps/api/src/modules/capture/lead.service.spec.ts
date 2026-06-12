import { ERROR_CODES } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction } from '../../core/db';
import type { OutboxService } from '../../core/outbox';
import { LeadService, type CreateLeadInput } from './lead.service';

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
  insertedRow?: unknown;
  returningRows?: unknown[];
} = {}): TxFake {
  const insertValues = jest.fn();
  const updateSet = jest.fn();
  const whereCalls = jest.fn();
  const executeTakeFirst = jest.fn(async () => ({ numUpdatedRows: opts.updatedRows ?? 1n }));
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

describe('LeadService.assignOwner', () => {
  it('skips the write when the owner is unchanged (idempotent per the SLA port contract)', async () => {
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const t = makeTx({
      selectedRow: { lead_id: LEAD, org_id: ORG, lead_code: 'LD-2026-000123', owner_id: 'owner-1', version: 2 },
    });
    const service = new LeadService(audit as unknown as AuditAppender, outbox as unknown as OutboxService);

    await service.assignOwner(LEAD, 'owner-1', 'SLA breach', t.tx);

    expect(t.updateSet).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it('updates the owner and emits audit(reassign) + LEAD_ASSIGNED outbox in the same tx', async () => {
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const t = makeTx({
      selectedRow: { lead_id: LEAD, org_id: ORG, lead_code: 'LD-2026-000123', owner_id: 'owner-old', version: 2 },
      updatedRows: 1n,
    });
    const service = new LeadService(audit as unknown as AuditAppender, outbox as unknown as OutboxService);

    await service.assignOwner(LEAD, 'owner-new', 'SLA breach reassignment', t.tx);

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reassign',
        entity_type: 'leads',
        lead_id: LEAD,
        detail: expect.objectContaining({ previous_owner_id: 'owner-old', new_owner_id: 'owner-new' }),
      }),
      t.tx,
    );
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_code: 'LEAD_ASSIGNED',
        aggregate_type: 'leads',
        aggregate_id: LEAD,
      }),
      t.tx,
    );
  });

  it('audits allocate (not reassign) on first assignment from a null owner', async () => {
    const audit = fakeAudit();
    const t = makeTx({
      selectedRow: { lead_id: LEAD, org_id: ORG, lead_code: 'LD-2026-000123', owner_id: null, version: 1 },
      updatedRows: 1n,
    });
    const service = new LeadService(audit as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);

    await service.assignOwner(LEAD, 'owner-new', 'allocation', t.tx);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'allocate' }),
      t.tx,
    );
  });

  it('throws NOT_FOUND for a missing/deleted lead', async () => {
    const t = makeTx({ selectedRow: undefined });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.assignOwner(LEAD, 'owner-new', 'x', t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('throws CONFLICT when a concurrent writer bumped the version', async () => {
    const t = makeTx({
      selectedRow: { lead_id: LEAD, org_id: ORG, lead_code: 'LD-2026-000123', owner_id: 'owner-old', version: 2 },
      updatedRows: 0n,
    });
    const service = new LeadService(fakeAudit() as unknown as AuditAppender, fakeOutbox() as unknown as OutboxService);
    await expect(service.assignOwner(LEAD, 'owner-new', 'x', t.tx)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
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
    ['setKycStatus', (s: LeadService, tx: DbTransaction) => s.setKycStatus(LEAD, 'verified', tx)],
    ['setConsentStatus', (s: LeadService, tx: DbTransaction) => s.setConsentStatus(LEAD, 'captured', tx)],
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
