import { DataScope } from '@lms/shared';

import { MAX_PAGE_LIMIT } from '../../core/common';
import type { DbTransaction } from '../../core/db';
import { RoleRepository, type PermissionToWrite } from './role.repository';

/**
 * FR-130 unit test for {@link RoleRepository.replacePermissions} (T-30): the
 * DELETE of the old set MUST precede the INSERT of the new set, and both run on
 * the SAME transaction handle. We drive a recording fake `tx` (no DB) and assert
 * the call order + that the inserted rows carry org/role/actor stamping.
 */

interface Recorded {
  order: string[];
  deleted: { role_id?: string; org_id?: string };
  inserted: Array<Record<string, unknown>>;
}

function recordingTx(rec: Recorded): DbTransaction {
  const deleteBuilder = {
    where(col: string, _op: string, val: string) {
      if (col === 'role_id') rec.deleted.role_id = val;
      if (col === 'org_id') rec.deleted.org_id = val;
      return deleteBuilder;
    },
    async execute() {
      rec.order.push('delete');
      return [];
    },
  };
  const insertBuilder = {
    values(rows: Array<Record<string, unknown>>) {
      rec.inserted = rows;
      return insertBuilder;
    },
    async execute() {
      rec.order.push('insert');
      return [];
    },
  };
  return {
    deleteFrom: (table: string) => {
      rec.order.push(`deleteFrom:${table}`);
      return deleteBuilder;
    },
    insertInto: (table: string) => {
      rec.order.push(`insertInto:${table}`);
      return insertBuilder;
    },
  } as unknown as DbTransaction;
}

describe('RoleRepository.replacePermissions', () => {
  it('deletes the old set then inserts the new set on the same tx (T-30)', async () => {
    const repo = new RoleRepository({} as never);
    const rec: Recorded = { order: [], deleted: {}, inserted: [] };
    const tx = recordingTx(rec);

    const perms: PermissionToWrite[] = [
      { capability: 'create_lead', max_scope: DataScope.B },
      { capability: 'view_lead', max_scope: DataScope.B },
      { capability: 'edit_lead', max_scope: DataScope.B },
    ];
    await repo.replacePermissions('org-1', 'role-bm', perms, 'admin-1', tx);

    // DELETE precedes INSERT.
    expect(rec.order.indexOf('delete')).toBeLessThan(rec.order.indexOf('insert'));
    expect(rec.deleted).toEqual({ role_id: 'role-bm', org_id: 'org-1' });
    expect(rec.inserted).toHaveLength(3);
    expect(rec.inserted[0]).toMatchObject({
      org_id: 'org-1',
      role_id: 'role-bm',
      capability: 'create_lead',
      max_scope: 'B',
      created_by: 'admin-1',
      updated_by: 'admin-1',
    });
  });

  it('clears the set (delete only) when the new permission list is empty', async () => {
    const repo = new RoleRepository({} as never);
    const rec: Recorded = { order: [], deleted: {}, inserted: [] };
    const tx = recordingTx(rec);

    await repo.replacePermissions('org-1', 'role-bm', [], 'admin-1', tx);

    expect(rec.order).toContain('delete');
    expect(rec.order).not.toContain('insert');
  });
});

/**
 * FR-130 E1 (Batch-2 integration): a role with > MAX_PAGE_LIMIT active holders
 * must yield EVERY user id so the cache eviction misses none. We drive a keyset
 * select fake that returns a full page (100) then a short page (5); the repo must
 * loop, advance the `user_id > after` cursor, and concatenate all 105 ids.
 */
function keysetUsersTx(pages: string[][]): { tx: DbTransaction; afters: Array<string | undefined>; calls: () => number } {
  let call = 0;
  const afters: Array<string | undefined> = [];
  const makeBuilder = () => {
    let after: string | undefined;
    const builder = {
      select: () => builder,
      where(col: string, op: string, val: string) {
        if (col === 'user_id' && op === '>') after = val;
        return builder;
      },
      orderBy: () => builder,
      limit: () => builder,
      async execute() {
        afters.push(after);
        const page = pages[call] ?? [];
        call += 1;
        return page.map((user_id) => ({ user_id }));
      },
    };
    return builder;
  };
  return {
    tx: { selectFrom: () => makeBuilder() } as unknown as DbTransaction,
    afters,
    calls: () => call,
  };
}

describe('RoleRepository.listAllUserIdsForRole', () => {
  it('paginates past MAX_PAGE_LIMIT and returns every holder (keyset advances)', async () => {
    const repo = new RoleRepository({} as never);
    const fullPage = Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => `user-${String(i).padStart(3, '0')}`);
    const shortPage = ['user-100', 'user-101', 'user-102', 'user-103', 'user-104'];
    const { tx, afters, calls } = keysetUsersTx([fullPage, shortPage]);

    const ids = await repo.listAllUserIdsForRole('org-1', 'role-bm', tx);

    expect(ids).toHaveLength(MAX_PAGE_LIMIT + shortPage.length);
    expect(ids[ids.length - 1]).toBe('user-104');
    // Two queries: first with no cursor, second keyed after the last id of page 1.
    expect(calls()).toBe(2);
    expect(afters).toEqual([undefined, fullPage[fullPage.length - 1]]);
  });

  it('stops after a single page when holders ≤ MAX_PAGE_LIMIT', async () => {
    const repo = new RoleRepository({} as never);
    const { tx, calls } = keysetUsersTx([['user-a', 'user-b']]);

    const ids = await repo.listAllUserIdsForRole('org-1', 'role-bm', tx);

    expect(ids).toEqual(['user-a', 'user-b']);
    expect(calls()).toBe(1);
  });
});
