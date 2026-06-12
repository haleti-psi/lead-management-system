import type { ScopePredicate } from '@lms/shared';

import { compileOnlyDb } from './lead-scope.service.spec';
import { SavedViewRepository } from './saved-view.repository';
import type { WorkspaceUserRef } from './lead-list.repository';

/**
 * FR-050 — compile-level tests for the saved-view visibility predicate
 * (TC-17's SQL slice: own ∪ in-scope shared, out-of-scope shared absent by
 * WHERE) and the single-row insert. Compiled only — never executed.
 */

const ORG = '00000000-0000-0000-0000-000000000001';

const bmCaller: WorkspaceUserRef = {
  user_id: 'bm-1',
  branch_id: 'branch-1',
  team_id: null,
  region_id: 'region-1',
};
const branchPredicate: ScopePredicate = { type: 'branch', branchId: 'branch-1' };

describe('SavedViewRepository.visibleViews (TC-17 SQL slice)', () => {
  const repo = new SavedViewRepository(compileOnlyDb());

  it('always returns own views and org-bounds the query', () => {
    const { sql, parameters } = repo.visibleViews(ORG, bmCaller, branchPredicate).selectAll('sv').compile();
    expect(sql).toContain('"sv"."org_id" = $1');
    expect(sql).toContain('"sv"."owner_id" = $');
    expect(parameters).toContain('bm-1');
  });

  it('shared views require is_shared = true plus a scope leg (never unconditional)', () => {
    const { sql } = repo.visibleViews(ORG, bmCaller, branchPredicate).selectAll('sv').compile();
    expect(sql).toContain('"sv"."is_shared" = $');
    expect(sql).toContain('"sv"."scope" = $');
  });

  it("BM: a view shared by an owner of the BM's branch is visible (containment leg)", () => {
    const { sql, parameters } = repo.visibleViews(ORG, bmCaller, branchPredicate).selectAll('sv').compile();
    // Audience legs (A / B / R for this caller) + the owner-in-branch containment leg.
    expect(sql).toContain('"u"."branch_id" = $');
    expect(parameters).toContain('branch-1');
    expect(parameters).toContain('A');
    expect(parameters).toContain('B');
  });

  it('SM (team predicate): shared views from team members are visible', () => {
    const smCaller: WorkspaceUserRef = {
      user_id: 'sm-1',
      branch_id: 'branch-1',
      team_id: 'team-1',
      region_id: null,
    };
    const { sql, parameters } = repo
      .visibleViews(ORG, smCaller, { type: 'team', userIds: ['rm-1', 'rm-2'] })
      .selectAll('sv')
      .compile();
    expect(sql).toContain('"sv"."owner_id" in ($');
    expect(sql).toContain('"u"."team_id" = $');
    expect(parameters).toEqual(expect.arrayContaining(['rm-1', 'rm-2', 'team-1']));
  });

  it('RM (own predicate, no team/branch row data): only own + A-shared legs remain', () => {
    const rmCaller: WorkspaceUserRef = {
      user_id: 'rm-1',
      branch_id: null,
      team_id: null,
      region_id: null,
    };
    const { sql } = repo
      .visibleViews(ORG, rmCaller, { type: 'own', userId: 'rm-1' })
      .selectAll('sv')
      .compile();
    expect(sql).not.toContain('"u"."branch_id"');
    expect(sql).not.toContain('"u"."team_id"');
  });

  it('HEAD/DPO (all/masked): every shared view in the org is visible (TRUE leg)', () => {
    const { parameters } = repo
      .visibleViews(ORG, bmCaller, { type: 'all', orgId: ORG })
      .selectAll('sv')
      .compile();
    expect(parameters).toContain(true);
  });

  it('list() compiles a LIMIT-bounded page and an orderBy on updated_at', () => {
    // Reconstruct the row query list() issues (compile-only proof of LIMIT).
    const compiled = repo
      .visibleViews(ORG, bmCaller, branchPredicate)
      .selectAll('sv')
      .orderBy('sv.updated_at', 'desc')
      .limit(25)
      .offset(0)
      .compile();
    expect(compiled.sql).toContain('order by "sv"."updated_at" desc');
    expect(compiled.sql).toContain('limit $');
    expect(compiled.parameters).toContain(25);
  });
});

describe('SavedViewRepository.create (TC-16 write fields)', () => {
  it('INSERTs a single row with owner_id/created_by/updated_by = caller and a JSON filter', async () => {
    const createdRow = { saved_view_id: 'sv-1' };
    const executeTakeFirstOrThrow = jest.fn().mockResolvedValue(createdRow);
    const returningAll = jest.fn(() => ({ executeTakeFirstOrThrow }));
    const values = jest.fn(() => ({ returningAll }));
    const insertInto = jest.fn(() => ({ values }));
    const repo = new SavedViewRepository({ insertInto } as unknown as ConstructorParameters<typeof SavedViewRepository>[0]);

    const result = await repo.create({
      org_id: ORG,
      owner_id: 'bm-1',
      name: 'Hot CV — North',
      filter_json: { is_hot: true },
      is_shared: true,
      scope: 'B',
    });

    expect(insertInto).toHaveBeenCalledWith('saved_views');
    expect(values).toHaveBeenCalledWith({
      org_id: ORG,
      owner_id: 'bm-1',
      name: 'Hot CV — North',
      filter_json: '{"is_hot":true}',
      is_shared: true,
      scope: 'B',
      created_by: 'bm-1',
      updated_by: 'bm-1',
    });
    expect(result).toBe(createdRow);
  });
});
