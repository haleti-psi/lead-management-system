import { ConfigGovernanceRepository } from './config-governance.repository';
import type { KyselyDb } from '../../core/db';

/**
 * FR-132 unit tests for {@link ConfigGovernanceRepository.listPending}: the query
 * always filters to `status='pending'` and the org, applies the optional
 * `config_type` filter, orders newest-first, and is ALWAYS LIMIT-bounded
 * (NFR-17). A recording Kysely fake captures the builder calls so the WHERE/LIMIT
 * shape is asserted without a database; the query is never executed for real.
 */

interface Recorded {
  table: string;
  wheres: Array<[string, string, unknown]>;
  limit?: number;
  offset?: number;
  orderBy?: [string, string];
}

/**
 * A Kysely fake whose `selectFrom` records every `.where()/.limit()/.offset()/
 * .orderBy()` call. The first chain built per call is the rows query, the second
 * is the count query (it ends in `.executeTakeFirstOrThrow()`).
 */
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

const PENDING_ROW = {
  configuration_version_id: 'cv-1',
  maker_id: 'maker-1',
  config_type: 'sla_policy',
  config_ref: 'pol-1',
  status: 'pending',
  created_at: new Date('2026-06-10T10:00:00.000Z'),
  diff: { name: 'x' },
};

describe('ConfigGovernanceRepository.listPending', () => {
  it('filters to org + status=pending, orders newest-first, and is LIMIT-bounded', async () => {
    const { db, calls } = recordingDb([PENDING_ROW], 1);
    const repo = new ConfigGovernanceRepository(db);

    const page = await repo.listPending({ page: 1, limit: 25 });

    expect(page.total).toBe(1);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].configuration_version_id).toBe('cv-1');
    expect(page.rows[0].created_at).toBeInstanceOf(Date);

    const rowsCall = calls[0];
    expect(rowsCall.table).toBe('configuration_versions');
    expect(rowsCall.wheres).toContainEqual(['status', '=', 'pending']);
    expect(rowsCall.wheres.some(([col]) => col === 'org_id')).toBe(true);
    expect(rowsCall.orderBy).toEqual(['created_at', 'desc']);
    expect(rowsCall.limit).toBe(25);
    expect(rowsCall.offset).toBe(0);
  });

  it('clamped LIMIT is honoured (≤100) and offset reflects the page', async () => {
    const { db, calls } = recordingDb([], 0);
    const repo = new ConfigGovernanceRepository(db);

    await repo.listPending({ page: 3, limit: 100 });

    expect(calls[0].limit).toBe(100);
    expect(calls[0].limit).toBeLessThanOrEqual(100);
    expect(calls[0].offset).toBe(200);
  });

  it('applies the optional config_type filter to both the rows and count queries', async () => {
    const { db, calls } = recordingDb([PENDING_ROW], 1);
    const repo = new ConfigGovernanceRepository(db);

    await repo.listPending({ page: 1, limit: 25, configType: 'sla_policy' });

    const [rowsCall, countCall] = calls;
    expect(rowsCall.wheres).toContainEqual(['config_type', '=', 'sla_policy']);
    expect(countCall.wheres).toContainEqual(['config_type', '=', 'sla_policy']);
    // The count query is also pinned to org + pending.
    expect(countCall.wheres).toContainEqual(['status', '=', 'pending']);
  });

  it('omits the config_type predicate when no filter is supplied', async () => {
    const { db, calls } = recordingDb([], 0);
    const repo = new ConfigGovernanceRepository(db);

    await repo.listPending({ page: 1, limit: 25 });

    expect(calls[0].wheres.some(([col]) => col === 'config_type')).toBe(false);
  });
});
