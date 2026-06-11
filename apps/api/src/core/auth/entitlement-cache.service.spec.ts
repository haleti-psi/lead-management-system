import type { Redis } from 'ioredis';

import { Capability, DataScope, RoleCode, UserStatus } from '@lms/shared';

import type { KyselyDb } from '../db';
import { actorCacheKey, teamMembersCacheKey } from './abac.constants';
import { EntitlementCacheService } from './entitlement-cache.service';

const ORG = '00000000-0000-0000-0000-000000000001';

/** Minimal in-memory Redis fake covering get/set(EX)/del. */
function fakeRedis(): { redis: Redis; store: Map<string, string>; delCalls: string[][] } {
  const store = new Map<string, string>();
  const delCalls: string[][] = [];
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      delCalls.push(keys);
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
  } as unknown as Redis;
  return { redis, store, delCalls };
}

/**
 * A Kysely fake whose terminal `.execute()` resolves to a fixed row set. The
 * builder methods are chainable no-ops; only the final result matters for these
 * unit tests (the SQL shape is exercised by integration tests with a real DB).
 */
function fakeDbReturning(rows: unknown[]): { db: KyselyDb; executed: number } {
  const state = { executed: 0 };
  const chain: Record<string, unknown> = {};
  const methods = [
    'selectFrom', 'innerJoin', 'leftJoin', 'where', 'select', 'limit', 'on', 'onRef',
  ];
  for (const m of methods) {
    chain[m] = jest.fn(() => chain);
  }
  chain['execute'] = jest.fn(async () => {
    state.executed += 1;
    return rows;
  });
  // leftJoin/innerJoin pass a callback (join) in one code path; support it.
  chain['leftJoin'] = jest.fn((_table: unknown, cb?: (j: unknown) => unknown) => {
    if (typeof cb === 'function') cb(chain);
    return chain;
  });
  chain['innerJoin'] = jest.fn((_table: unknown, _a?: unknown, _b?: unknown) => chain);
  const db = chain as unknown as KyselyDb;
  return { db, executed: state.executed };
}

const actorRow = (capability: Capability | null, maxScope: DataScope | null): Record<string, unknown> => ({
  user_id: 'rm-1',
  org_id: ORG,
  status: UserStatus.ACTIVE,
  role_id: 'role-rm',
  role_code: RoleCode.RM,
  default_scope: DataScope.O,
  branch_id: 'B1',
  team_id: 'T1',
  region_id: null,
  partner_id: null,
  capability,
  max_scope: maxScope,
  conditions: null,
});

describe('EntitlementCacheService', () => {
  it('loads the actor on a cache miss, populates Redis, and rehydrates the permissions Map', async () => {
    const { redis, store } = fakeRedis();
    const { db } = fakeDbReturning([
      actorRow(Capability.VIEW_LEAD, DataScope.O),
      actorRow(Capability.EDIT_LEAD, DataScope.O),
    ]);
    const svc = new EntitlementCacheService(db, redis);

    const actor = await svc.loadActorEntitlement('rm-1', ORG);

    expect(actor?.roleCode).toBe(RoleCode.RM);
    expect(actor?.permissions.get(Capability.VIEW_LEAD)?.maxScope).toBe(DataScope.O);
    expect(actor?.permissions.get(Capability.EDIT_LEAD)?.maxScope).toBe(DataScope.O);
    // Cache populated under the org+user key.
    expect(store.has(actorCacheKey(ORG, 'rm-1'))).toBe(true);
  });

  it('serves a second lookup from cache without re-querying the DB', async () => {
    const { redis } = fakeRedis();
    const { db } = fakeDbReturning([actorRow(Capability.VIEW_LEAD, DataScope.O)]);
    const execSpy = (db as unknown as { execute: jest.Mock }).execute;
    const svc = new EntitlementCacheService(db, redis);

    await svc.loadActorEntitlement('rm-1', ORG);
    const callsAfterFirst = execSpy.mock.calls.length;
    await svc.loadActorEntitlement('rm-1', ORG);

    expect(execSpy.mock.calls.length).toBe(callsAfterFirst); // no extra DB execute
  });

  it('returns undefined for an unknown/inactive actor (empty row set)', async () => {
    const { redis } = fakeRedis();
    const { db } = fakeDbReturning([]);
    const svc = new EntitlementCacheService(db, redis);
    await expect(svc.loadActorEntitlement('ghost', ORG)).resolves.toBeUndefined();
  });

  it('yields an empty permission map when the role has a row but no capabilities', async () => {
    const { redis } = fakeRedis();
    const { db } = fakeDbReturning([actorRow(null, null)]);
    const svc = new EntitlementCacheService(db, redis);
    const actor = await svc.loadActorEntitlement('rm-1', ORG);
    expect(actor?.permissions.size).toBe(0);
  });

  // E1 — invalidation hook for FR-130.
  it('invalidateUser deletes exactly the actor cache key', async () => {
    const { redis, store, delCalls } = fakeRedis();
    const { db } = fakeDbReturning([actorRow(Capability.VIEW_LEAD, DataScope.O)]);
    const svc = new EntitlementCacheService(db, redis);

    await svc.loadActorEntitlement('rm-1', ORG);
    expect(store.has(actorCacheKey(ORG, 'rm-1'))).toBe(true);

    await svc.invalidateUser('rm-1', ORG);
    expect(store.has(actorCacheKey(ORG, 'rm-1'))).toBe(false);
    expect(delCalls.at(-1)).toEqual([actorCacheKey(ORG, 'rm-1')]);
  });

  it('invalidateRole evicts every affected user key (no stale grant after a role change)', async () => {
    const { redis, delCalls } = fakeRedis();
    const { db } = fakeDbReturning([]);
    const svc = new EntitlementCacheService(db, redis);

    await svc.invalidateRole('role-rm', [
      { userId: 'rm-1', orgId: ORG },
      { userId: 'rm-2', orgId: ORG },
    ]);

    expect(delCalls.at(-1)).toEqual([actorCacheKey(ORG, 'rm-1'), actorCacheKey(ORG, 'rm-2')]);
  });

  it('invalidateRole is a no-op when no users are affected', async () => {
    const { redis, delCalls } = fakeRedis();
    const { db } = fakeDbReturning([]);
    const svc = new EntitlementCacheService(db, redis);
    await svc.invalidateRole('role-rm', []);
    expect(delCalls).toHaveLength(0);
  });

  it('caches team member ids under the team key (scope T list)', async () => {
    const { redis, store } = fakeRedis();
    const { db } = fakeDbReturning([{ user_id: 'rm-a' }, { user_id: 'rm-b' }]);
    const svc = new EntitlementCacheService(db, redis);

    const ids = await svc.loadTeamMemberIds('T1', ORG);
    expect(ids).toEqual(['rm-a', 'rm-b']);
    expect(store.has(teamMembersCacheKey('T1'))).toBe(true);
  });
});
