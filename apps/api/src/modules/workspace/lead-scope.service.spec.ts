import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';

import type { ScopePredicate } from '@lms/shared';

import type { DB, KyselyDb } from '../../core/db';
import { LeadScopeService, leadListBase } from './lead-scope.service';

/**
 * FR-050 — TC-24: `LeadScopeService.applyScope` compiles the correct SQL
 * predicate per role scope (the predicate FR-002's EntitlementService resolves
 * for RM/SM/BM/HEAD/DPO). Queries are COMPILED, never executed — the pool
 * factory throws if anything tries to connect, proving these are pure
 * query-builder assertions over the real Kysely pipeline.
 */

export function compileOnlyDb(): KyselyDb {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: async (): Promise<Pool> => {
        throw new Error('compile-only test database — queries must never execute');
      },
    }),
  });
}

const ORG = '00000000-0000-0000-0000-000000000001';

describe('LeadScopeService.applyScope (TC-24)', () => {
  const db = compileOnlyDb();
  const service = new LeadScopeService();

  const compileFor = (predicate: ScopePredicate | undefined) =>
    service.applyScope(leadListBase(db, ORG), predicate).select('l.lead_id').compile();

  it('always scopes to org + deleted_at IS NULL (base query)', () => {
    const { sql, parameters } = compileFor({ type: 'all', orgId: ORG });
    expect(sql).toContain('"l"."org_id" = $1');
    expect(sql).toContain('"l"."deleted_at" is null');
    expect(parameters).toEqual([ORG]);
  });

  it('RM (own) → l.owner_id = caller', () => {
    const { sql, parameters } = compileFor({ type: 'own', userId: 'rm-a' });
    expect(sql).toContain('"l"."owner_id" = $2');
    expect(parameters).toEqual([ORG, 'rm-a']);
  });

  it('SM (team) → l.owner_id IN (team member ids) — CORRECTIONS: never team_id', () => {
    const { sql, parameters } = compileFor({ type: 'team', userIds: ['rm-1', 'rm-2'] });
    expect(sql).toContain('"l"."owner_id" in ($2, $3)');
    expect(sql).not.toContain('"l"."team_id"');
    expect(parameters).toEqual([ORG, 'rm-1', 'rm-2']);
  });

  it('SM with an EMPTY team compiles to FALSE (deny-by-default, valid SQL)', () => {
    const { parameters } = compileFor({ type: 'team', userIds: [] });
    expect(parameters).toEqual([ORG, false]);
  });

  it('BM (branch) → l.branch_id = branch', () => {
    const { sql, parameters } = compileFor({ type: 'branch', branchId: 'branch-1' });
    expect(sql).toContain('"l"."branch_id" = $2');
    expect(parameters).toEqual([ORG, 'branch-1']);
  });

  it('region → l.branch_id IN (region branches)', () => {
    const { sql, parameters } = compileFor({ type: 'region', branchIds: ['b1', 'b2'] });
    expect(sql).toContain('"l"."branch_id" in ($2, $3)');
    expect(parameters).toEqual([ORG, 'b1', 'b2']);
  });

  it('HEAD (all) adds no extra row predicate beyond the org bound', () => {
    const { sql, parameters } = compileFor({ type: 'all', orgId: ORG });
    expect(sql).not.toContain('"l"."owner_id"');
    expect(sql).not.toContain('"l"."branch_id" =');
    expect(parameters).toEqual([ORG]);
  });

  it('DPO (masked) sees all-org rows (force-masking is the serialisation layer)', () => {
    const { sql, parameters } = compileFor({ type: 'masked', orgId: ORG });
    expect(sql).not.toContain('"l"."owner_id"');
    expect(parameters).toEqual([ORG]);
  });

  it('a MISSING predicate compiles to FALSE — the scope step is never skipped', () => {
    const { parameters } = compileFor(undefined);
    expect(parameters).toEqual([ORG, false]);
  });

  it('partner predicate pins sa.partner_id (defence in depth; FR-050 denies upstream)', () => {
    const { sql, parameters } = compileFor({ type: 'partner', partnerId: 'p-9' });
    expect(sql).toContain('"sa"."partner_id" = $2');
    expect(parameters).toEqual([ORG, 'p-9']);
  });

  it('customer_token predicate pins the single lead', () => {
    const { sql, parameters } = compileFor({ type: 'customer_token', leadId: 'lead-7' });
    expect(sql).toContain('"l"."lead_id" = $2');
    expect(parameters).toEqual([ORG, 'lead-7']);
  });
});
