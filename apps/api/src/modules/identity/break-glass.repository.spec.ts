import { GrantStatus } from '@lms/shared';

import { BreakGlassRepository } from './break-glass.repository';
import type { KyselyDb } from '../../core/db';

/**
 * FR-003 unit tests for {@link BreakGlassRepository.list}: the query is always
 * org-scoped, applies the optional `status` filter, orders newest-first, and is
 * ALWAYS LIMIT-bounded (NFR-17). A recording Kysely fake captures the builder
 * calls so the WHERE/LIMIT shape is asserted without a database; the query is
 * never executed for real.
 */

interface Recorded {
  table: string;
  wheres: Array<[string, string, unknown]>;
  limit?: number;
  offset?: number;
  orderBy?: [string, string];
}

function recordingDb(rows: Record<string, unknown>[], count: number): {
  db: KyselyDb;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const makeChain = (rec: Recorded) => {
    const chain = {
      select: () => chain,
      where: (col: string, op: string, val: unknown) => {
        rec.wheres.push([col, op, val]);
        return chain;
      },
      orderBy: (col: string, dir: string) => {
        rec.orderBy = [col, dir];
        return chain;
      },
      limit: (n: number) => {
        rec.limit = n;
        return chain;
      },
      offset: (n: number) => {
        rec.offset = n;
        return chain;
      },
      async execute() {
        return rows;
      },
      async executeTakeFirstOrThrow() {
        return { count: String(count) };
      },
    };
    return chain;
  };
  const db = {
    selectFrom: (table: string) => {
      const rec: Recorded = { table, wheres: [] };
      calls.push(rec);
      return makeChain(rec);
    },
  } as unknown as KyselyDb;
  return { db, calls };
}

const ORG = '00000000-0000-0000-0000-000000000001';

const GRANT_ROW = {
  grant_id: 'grant-1',
  grantee_id: 'grantee-1',
  maker_id: 'maker-1',
  approver_id: 'approver-1',
  scope_type: 'lead',
  scope_ref: 'lead-1',
  status: 'active',
  reason: 'Incident review',
  valid_from: new Date('2026-06-09T09:00:00.000Z'),
  valid_until: new Date('2026-06-09T11:00:00.000Z'),
};

describe('BreakGlassRepository.list', () => {
  it('scopes to the org, orders newest-first, and is LIMIT-bounded', async () => {
    const { db, calls } = recordingDb([GRANT_ROW], 1);
    const repo = new BreakGlassRepository(db);

    const page = await repo.list(ORG, { page: 1, limit: 25 });

    expect(page.total).toBe(1);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].grant_id).toBe('grant-1');
    expect(page.rows[0].maker_id).toBe('maker-1');
    expect(page.rows[0].valid_from).toBeInstanceOf(Date);

    const rowsCall = calls[0];
    expect(rowsCall.table).toBe('break_glass_grants');
    expect(rowsCall.wheres).toContainEqual(['org_id', '=', ORG]);
    expect(rowsCall.orderBy).toEqual(['created_at', 'desc']);
    expect(rowsCall.limit).toBe(25);
    expect(rowsCall.offset).toBe(0);
  });

  it('honours a clamped LIMIT (≤100) and computes the page offset', async () => {
    const { db, calls } = recordingDb([], 0);
    const repo = new BreakGlassRepository(db);

    await repo.list(ORG, { page: 4, limit: 100 });

    expect(calls[0].limit).toBe(100);
    expect(calls[0].limit).toBeLessThanOrEqual(100);
    expect(calls[0].offset).toBe(300);
  });

  it('applies the optional status filter to both the rows and count queries', async () => {
    const { db, calls } = recordingDb([GRANT_ROW], 1);
    const repo = new BreakGlassRepository(db);

    await repo.list(ORG, { page: 1, limit: 25, status: GrantStatus.ACTIVE });

    const [rowsCall, countCall] = calls;
    expect(rowsCall.wheres).toContainEqual(['status', '=', GrantStatus.ACTIVE]);
    expect(countCall.wheres).toContainEqual(['status', '=', GrantStatus.ACTIVE]);
    expect(countCall.wheres).toContainEqual(['org_id', '=', ORG]);
  });

  it('omits the status predicate when no filter is supplied', async () => {
    const { db, calls } = recordingDb([], 0);
    const repo = new BreakGlassRepository(db);

    await repo.list(ORG, { page: 1, limit: 25 });

    expect(calls[0].wheres.some(([col]) => col === 'status')).toBe(false);
  });
});
