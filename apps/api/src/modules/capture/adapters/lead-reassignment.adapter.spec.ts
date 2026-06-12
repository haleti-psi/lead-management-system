import type { DbTransaction } from '../../../core/db';
import type { LeadService } from '../lead.service';
import { LeadReassignmentAdapter } from './lead-reassignment.adapter';

/**
 * FR-010 — the FR-130 owner-writes seam adapter (`LEAD_REASSIGN_PORT`): selects
 * open leads of the deactivated user in LIMIT-bounded batches and hands each
 * batch to `LeadService.bulkReassign` inside the caller's tx.
 */
describe('LeadReassignmentAdapter', () => {
  interface BatchChainMock {
    select: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    execute: jest.Mock;
  }

  function txReturningBatches(batches: Array<Array<{ lead_id: string }>>): {
    tx: DbTransaction;
    limitCalls: jest.Mock;
  } {
    let call = 0;
    const limitCalls = jest.fn();
    const chain: BatchChainMock = {
      select: jest.fn(() => chain),
      where: jest.fn(() => chain),
      orderBy: jest.fn(() => chain),
      limit: jest.fn((n: number) => {
        limitCalls(n);
        return chain;
      }),
      execute: jest.fn(async () => batches[call++] ?? []),
    };
    return { tx: { selectFrom: jest.fn(() => chain) } as unknown as DbTransaction, limitCalls };
  }

  it('reassigns batch-by-batch until no open lead remains, returning the total', async () => {
    const bulkReassign = jest
      .fn()
      .mockImplementation(async (ids: string[]) => ids.length);
    const leads = { bulkReassign } as unknown as LeadService;
    const batch1 = Array.from({ length: 100 }, (_, i) => ({ lead_id: `lead-${i}` }));
    const batch2 = [{ lead_id: 'lead-100' }, { lead_id: 'lead-101' }];
    const { tx, limitCalls } = txReturningBatches([batch1, batch2, []]);

    const adapter = new LeadReassignmentAdapter(leads);
    const total = await adapter.bulkReassign('user-old', 'user-new', 'deactivation', tx);

    expect(total).toBe(102);
    expect(bulkReassign).toHaveBeenCalledTimes(2);
    expect(bulkReassign).toHaveBeenNthCalledWith(
      1,
      batch1.map((r) => r.lead_id),
      'user-new',
      'deactivation',
      tx,
    );
    // Every SELECT is LIMIT-bounded at 100 (performance.md hard rule).
    for (const call of limitCalls.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(100);
    }
  });

  it('returns 0 when the user owns no open leads', async () => {
    const bulkReassign = jest.fn();
    const { tx } = txReturningBatches([[]]);
    const adapter = new LeadReassignmentAdapter({ bulkReassign } as unknown as LeadService);

    await expect(adapter.bulkReassign('user-old', 'user-new', 'x', tx)).resolves.toBe(0);
    expect(bulkReassign).not.toHaveBeenCalled();
  });
});
