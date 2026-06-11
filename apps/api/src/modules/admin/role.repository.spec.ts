import { DataScope } from '@lms/shared';

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
