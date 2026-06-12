import type { DbTransaction } from '../../core/db';
import { DedupeRepository, type PairMatchSnapshot } from './dedupe.repository';
import { MergeLeadRepository } from './merge-lead.repository';

/**
 * FR-021 — structural tests for the merge data layer (the live-SQL tier is the
 * deferred Testcontainers wave): which columns each re-parent writes and which
 * WHERE keys scope it. The load-bearing assertion is the A6 rule (T-030's
 * service-side analogue): the consent re-parent sets the `lead_id` FK (+
 * bookkeeping `updated_at`) and NOTHING else — consent state stays append-only.
 * Also covers the `duplicate_matches` pair transitions (T-021 / unmerge
 * restore) owned by DedupeRepository, the table's sole writer.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const DUP = 'b0000000-0000-0000-0000-00000000000b';
const MASTER = 'a0000000-0000-0000-0000-00000000000a';
const ACTOR = 'bm-1';

interface TxFake {
  tx: DbTransaction;
  updateSet: jest.Mock;
  whereCalls: jest.Mock;
  returningCols: jest.Mock;
}

function makeTx(opts: { rows?: unknown[]; updatedRows?: bigint } = {}): TxFake {
  const updateSet = jest.fn();
  const whereCalls = jest.fn();
  const returningCols = jest.fn();
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['updateTable', 'selectFrom', 'select', 'orderBy', 'limit']) {
    chain[m] = jest.fn(self);
  }
  chain['set'] = jest.fn((v: unknown) => {
    updateSet(v);
    return chain;
  });
  chain['where'] = jest.fn((...args: unknown[]) => {
    whereCalls(...args);
    return chain;
  });
  chain['returning'] = jest.fn((cols: unknown) => {
    returningCols(cols);
    return chain;
  });
  chain['execute'] = jest.fn(async () => opts.rows ?? []);
  chain['executeTakeFirst'] = jest.fn(async () =>
    opts.updatedRows !== undefined ? { numUpdatedRows: opts.updatedRows } : (opts.rows ?? [])[0],
  );
  return { tx: chain as unknown as DbTransaction, updateSet, whereCalls, returningCols };
}

describe('MergeLeadRepository re-parents (merge)', () => {
  const repo = new MergeLeadRepository();

  it('T-030/A6: reparentConsents sets the lead_id FK + updated_at ONLY — never consent state', async () => {
    const t = makeTx({ rows: [{ consent_id: 'c1' }, { consent_id: 'c2' }] });
    const ids = await repo.reparentConsents(DUP, MASTER, ORG, t.tx);

    expect(ids).toEqual(['c1', 'c2']);
    const patch = t.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch['lead_id']).toBe(MASTER);
    expect(Object.keys(patch).sort()).toEqual(['lead_id', 'updated_at']); // no state/superseded_by/actor
    expect(t.whereCalls).toHaveBeenCalledWith('lead_id', '=', DUP);
    expect(t.whereCalls).toHaveBeenCalledWith('org_id', '=', ORG);
  });

  it('T-014 analogue: reparentDocuments moves every duplicate document to the master and returns the ids', async () => {
    const t = makeTx({ rows: [{ document_id: 'd1' }, { document_id: 'd2' }, { document_id: 'd3' }] });
    const ids = await repo.reparentDocuments(DUP, MASTER, ORG, ACTOR, t.tx);

    expect(ids).toEqual(['d1', 'd2', 'd3']);
    expect(t.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: MASTER, updated_by: ACTOR }),
    );
    expect(t.whereCalls).toHaveBeenCalledWith('lead_id', '=', DUP);
  });

  it('T-016 analogue: reparentTasks moves the duplicate tasks to the master', async () => {
    const t = makeTx({ rows: [{ task_id: 't1' }] });
    const ids = await repo.reparentTasks(DUP, MASTER, ORG, ACTOR, t.tx);
    expect(ids).toEqual(['t1']);
    expect(t.updateSet).toHaveBeenCalledWith(expect.objectContaining({ lead_id: MASTER }));
  });

  it('T-017 analogue: setAttributionStatus UPDATEs the status in place (row preserved, never deleted)', async () => {
    const t = makeTx({ updatedRows: 1n });
    const count = await repo.setAttributionStatus('sa-1', 'merged_into', ORG, ACTOR, t.tx);
    expect(count).toBe(1);
    expect(t.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ attribution_status: 'merged_into', updated_by: ACTOR }),
    );
    expect(t.whereCalls).toHaveBeenCalledWith('source_attribution_id', '=', 'sa-1');
    expect(t.whereCalls).toHaveBeenCalledWith('org_id', '=', ORG);
  });
});

describe('MergeLeadRepository restores (unmerge)', () => {
  const repo = new MergeLeadRepository();

  it('T-026 analogue: restoreDocuments restores ONLY the listed ids still parented to the master', async () => {
    const t = makeTx({ rows: [{ document_id: 'd1' }, { document_id: 'd2' }] });
    const count = await repo.restoreDocuments(['d1', 'd2'], MASTER, DUP, ORG, ACTOR, t.tx);

    expect(count).toBe(2);
    expect(t.updateSet).toHaveBeenCalledWith(expect.objectContaining({ lead_id: DUP }));
    expect(t.whereCalls).toHaveBeenCalledWith('lead_id', '=', MASTER);
    expect(t.whereCalls).toHaveBeenCalledWith('document_id', 'in', ['d1', 'd2']);
  });

  it('restoreConsents keeps the A6 FK-only rule on the way back too', async () => {
    const t = makeTx({ rows: [{ consent_id: 'c1' }] });
    await repo.restoreConsents(['c1'], MASTER, DUP, ORG, t.tx);
    const patch = t.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(['lead_id', 'updated_at']);
    expect(t.whereCalls).toHaveBeenCalledWith('consent_id', 'in', ['c1']);
  });

  it('empty id lists short-circuit to 0 without touching the database', async () => {
    const t = makeTx();
    await expect(repo.restoreDocuments([], MASTER, DUP, ORG, ACTOR, t.tx)).resolves.toBe(0);
    await expect(repo.restoreConsents([], MASTER, DUP, ORG, t.tx)).resolves.toBe(0);
    await expect(repo.restoreTasks([], MASTER, DUP, ORG, ACTOR, t.tx)).resolves.toBe(0);
    expect(t.updateSet).not.toHaveBeenCalled();
  });
});

describe('DedupeRepository pair transitions (FR-021)', () => {
  const repo = new DedupeRepository();

  it('T-021 analogue: resolvePairAsMerged resolves the pair with action=merged + actor/reason', async () => {
    const t = makeTx({ rows: [{ duplicate_match_id: 'dm-1' }] });
    const count = await repo.resolvePairAsMerged(DUP, MASTER, ORG, ACTOR, 'dup of master', t.tx);

    expect(count).toBe(1);
    expect(t.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        action: 'merged',
        action_by: ACTOR,
        action_reason: 'dup of master',
        updated_by: ACTOR,
      }),
    );
    expect(t.whereCalls).toHaveBeenCalledWith('org_id', '=', ORG);
  });

  it('reopenMatches restores each snapshotted row to its PRE-merge action/status (recompute-safe)', async () => {
    const t = makeTx({ updatedRows: 1n });
    const snapshots: PairMatchSnapshot[] = [
      { duplicate_match_id: 'dm-1', action: 'warned', status: 'open', action_by: null, action_reason: null },
      { duplicate_match_id: 'dm-2', action: 'overridden', status: 'resolved', action_by: 'bm-0', action_reason: 'ok' },
    ];
    const count = await repo.reopenMatches(snapshots, ORG, ACTOR, t.tx);

    expect(count).toBe(2);
    expect(t.updateSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'open', action: 'warned', action_by: null }),
    );
    expect(t.updateSet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'resolved', action: 'overridden', action_by: 'bm-0' }),
    );
    expect(t.whereCalls).toHaveBeenCalledWith('duplicate_match_id', '=', 'dm-1');
    expect(t.whereCalls).toHaveBeenCalledWith('duplicate_match_id', '=', 'dm-2');
  });

  it('reopenMatches with no snapshots is a no-op returning 0', async () => {
    const t = makeTx();
    await expect(repo.reopenMatches([], ORG, ACTOR, t.tx)).resolves.toBe(0);
    expect(t.updateSet).not.toHaveBeenCalled();
  });
});
