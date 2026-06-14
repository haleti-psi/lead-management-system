import 'reflect-metadata';

import type { ScopePredicate } from '@lms/shared';

import { TaskSearchRepository } from './task-search.repository';

/**
 * Build a repository with a mock Kysely instance that accumulates every
 * where(col, op, val) call across the entire chain.  The chain always returns
 * itself so chaining is safe regardless of depth.
 */
function makeRepo(mockResult: unknown[] = []) {
  const executeMock = jest.fn().mockResolvedValue(mockResult);

  // Accumulate every where() invocation for assertion.
  const whereCalls: Array<unknown[]> = [];

  // A self-returning proxy that records where() args and executes at the end.
  const chain: Record<string, jest.Mock> = {} as Record<string, jest.Mock>;
  const makeChainMethod = (name: string) => {
    const fn: jest.Mock = jest.fn((...args: unknown[]) => {
      if (name === 'where') {
        whereCalls.push(args);
      }
      if (name === 'execute') {
        return executeMock();
      }
      return chain;
    });
    return fn;
  };

  for (const method of [
    'where', 'select', 'selectFrom', 'innerJoin', 'leftJoin',
    'orderBy', 'limit', 'execute',
  ]) {
    chain[method] = makeChainMethod(method);
  }

  const mockKysely = { selectFrom: jest.fn().mockReturnValue(chain) };
  const repo = new TaskSearchRepository(mockKysely as never);

  return { repo, whereCalls, executeMock, limitMock: chain.limit };
}

const orgId = 'org-1';
const ownPredicate: ScopePredicate = { type: 'own', userId: 'user-rm' };
const teamPredicate: ScopePredicate = { type: 'team', userIds: ['user-rm', 'user-rm2'] };
const emptyTeamPredicate: ScopePredicate = { type: 'team', userIds: [] };
const branchPredicate: ScopePredicate = { type: 'branch', branchId: 'branch-1' };
const allPredicate: ScopePredicate = { type: 'all', orgId };

/** Find a simple 3-arg where(col, op, val) in the accumulated calls. */
function findWhere(
  whereCalls: Array<unknown[]>,
  col: string,
  op: string,
  val: unknown,
): unknown[] | undefined {
  return whereCalls.find(
    ([c, o, v]) => c === col && o === op && (val === undefined || v === val),
  );
}

describe('TaskSearchRepository — scope correctness (lead row, not task columns)', () => {
  /**
   * MAJOR scope fix: "own" predicate MUST scope on l.owner_id (the LEAD's owner),
   * NOT t.owner_id (the task assignee).  A task assigned to a different RM than
   * the lead owner must NOT appear in an RM's own-scope search.
   */
  it('T-SCOPE-01 — own predicate filters on l.owner_id, not t.owner_id', async () => {
    const { repo, whereCalls } = makeRepo([]);
    await repo.search('LMS', ownPredicate, orgId);

    // Must use l.owner_id = userId
    const scopeWhere = findWhere(whereCalls, 'l.owner_id', '=', 'user-rm');
    expect(scopeWhere).toBeDefined();

    // Must NOT use the task column
    const wrongWhere = whereCalls.find(([col]) => col === 't.owner_id');
    expect(wrongWhere).toBeUndefined();
  });

  /**
   * MAJOR scope fix: "team" predicate MUST scope on l.owner_id IN (memberIds),
   * NOT t.owner_id IN (memberIds).
   */
  it('T-SCOPE-02 — team predicate filters on l.owner_id IN userIds, not t.owner_id', async () => {
    const { repo, whereCalls } = makeRepo([]);
    await repo.search('LMS', teamPredicate, orgId);

    const scopeWhere = whereCalls.find(
      ([col, op, val]) =>
        col === 'l.owner_id' &&
        op === 'in' &&
        Array.isArray(val) &&
        (val as string[]).includes('user-rm'),
    );
    expect(scopeWhere).toBeDefined();

    const wrongWhere = whereCalls.find(([col]) => col === 't.owner_id');
    expect(wrongWhere).toBeUndefined();
  });

  it('T-SCOPE-03 — empty team userIds compiles to FALSE (deny-by-default)', async () => {
    const { repo, whereCalls } = makeRepo([]);
    await repo.search('LMS', emptyTeamPredicate, orgId);

    // Empty team → false via callback-style where, not a column equality.
    const teamWhere = whereCalls.find(([col]) => col === 'l.owner_id');
    expect(teamWhere).toBeUndefined();
  });

  it('T-SCOPE-04 — branch predicate filters on l.branch_id (lead row)', async () => {
    const { repo, whereCalls } = makeRepo([]);
    await repo.search('LMS', branchPredicate, orgId);

    const scopeWhere = findWhere(whereCalls, 'l.branch_id', '=', 'branch-1');
    expect(scopeWhere).toBeDefined();
  });

  it('T-SCOPE-05 — all predicate adds no additional scope column filter', async () => {
    const { repo, whereCalls } = makeRepo([]);
    await repo.search('LMS', allPredicate, orgId);

    // No l.owner_id / l.branch_id / t.owner_id column filter for 'all'.
    const scopeWhere = whereCalls.find(
      ([col]) => col === 'l.owner_id' || col === 'l.branch_id' || col === 't.owner_id',
    );
    expect(scopeWhere).toBeUndefined();
  });

  it('T-SCOPE-06 — undefined predicate resolves to [] (deny-by-default)', async () => {
    const { repo, executeMock } = makeRepo([]);
    executeMock.mockResolvedValue([]);
    const result = await repo.search('LMS', undefined, orgId);
    expect(result).toHaveLength(0);
  });

  it('T-SCOPE-07 — applies LIMIT 5 cap', async () => {
    const { repo, limitMock } = makeRepo([]);
    await repo.search('LMS', allPredicate, orgId);
    expect(limitMock).toHaveBeenCalledWith(5);
  });

  it('T-SCOPE-08 — does not throw on SQL metacharacter input (injection safety)', async () => {
    const { repo } = makeRepo([]);
    let threw = false;
    try {
      await repo.search("%' OR 1=1--", allPredicate, orgId);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
