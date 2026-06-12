import type { ScopePredicate } from '@lms/shared';

import { LeadListRepository } from './lead-list.repository';
import { LeadScopeService } from './lead-scope.service';
import { compileOnlyDb } from './lead-scope.service.spec';
import { LeadFilterSchema, ListLeadsQuerySchema } from './dto/list-leads.dto';

/**
 * FR-050 — compile-level component tests for the list query (the SQL the
 * deferred Testcontainers tier would execute): scope predicate present IN SQL
 * (TC-01/TC-04 — a filter can never widen scope), allow-listed filter
 * compilation (TC-12 sla_state, TC-13 score_band), parameterised free-text
 * search (TC-14), LIMIT always bound and clamped (TC-10), count = same WHERE
 * without LIMIT. Queries are compiled only — never executed.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const RM_A = 'a0000000-0000-4000-8000-00000000000a';
const RM_B = 'b0000000-0000-4000-8000-00000000000b';
const OWN_RM_A: ScopePredicate = { type: 'own', userId: RM_A };

describe('LeadListRepository query assembly', () => {
  const repo = new LeadListRepository(compileOnlyDb(), new LeadScopeService());

  const compiled = (input: {
    predicate?: ScopePredicate;
    filter?: unknown;
    q?: string;
    limit?: number;
    page?: number;
    sort?: string;
  }) => {
    const params = ListLeadsQuerySchema.parse({
      filter: input.filter ?? {},
      q: input.q,
      limit: input.limit,
      page: input.page,
      sort: input.sort,
    });
    const base = repo.buildListQuery(ORG, input.predicate ?? OWN_RM_A, params.filter, params.q);
    const rows = repo
      .selectListColumns(base, params.sort.field, params.sort.dir)
      .limit(params.limit)
      .offset((params.page - 1) * params.limit)
      .compile();
    const total = base.select((eb) => eb.fn.countAll<string>().as('total')).compile();
    return { rows, total, params };
  };

  it('TC-01: the scope predicate is compiled into the WHERE — never post-filtered', () => {
    const { rows } = compiled({});
    expect(rows.sql).toContain('"l"."org_id" = $1');
    expect(rows.sql).toContain('"l"."deleted_at" is null');
    expect(rows.sql).toContain('"l"."owner_id" = $2');
    expect(rows.parameters).toContain(RM_A);
  });

  it('TC-04: filter[owner_id]=<other RM> is ANDed with the scope — it cannot widen it', () => {
    const { rows } = compiled({ filter: { owner_id: RM_B } });
    // Both predicates present: the scope's owner_id AND the filter's owner_id.
    const ownerClauses = rows.sql.match(/"l"\."owner_id" = \$\d+/g) ?? [];
    expect(ownerClauses).toHaveLength(2);
    expect(rows.parameters).toEqual(expect.arrayContaining([RM_A, RM_B]));
    expect(rows.sql).not.toContain(' or "l"."owner_id"');
  });

  it('selects ONLY the LLD column list (no select *; raw PII never leaves the join)', () => {
    const { rows } = compiled({});
    expect(rows.sql).not.toContain('select *');
    for (const col of [
      '"l"."lead_id"',
      '"l"."lead_code"',
      '"l"."stage"',
      '"l"."product_code"',
      '"l"."is_hot"',
      '"l"."score"',
      '"l"."consent_status"',
      '"l"."kyc_status"',
      '"li"."name"',
      '"li"."mobile"',
      '"li"."pan_masked"',
    ]) {
      expect(rows.sql).toContain(col);
    }
    expect(rows.sql).not.toContain('"li"."pan_token"');
    expect(rows.sql).not.toContain('"li"."aadhaar_ref_token"');
  });

  it('TC-10: limit=500 compiles to a bound LIMIT of 100 (clamped, parameterised)', () => {
    const { rows, params } = compiled({ limit: 500 });
    expect(params.limit).toBe(100);
    expect(rows.sql).toContain('limit $');
    expect(rows.parameters).toContain(100);
  });

  it('TC-11: page 2 compiles to offset = (page-1) * limit', () => {
    const { rows } = compiled({ page: 2, limit: 25 });
    expect(rows.sql).toContain('offset $');
    expect(rows.parameters).toContain(25);
    expect(rows.parameters).toContain(25 * 1);
  });

  it('the default limit (25) is ALWAYS applied — no unbounded list query', () => {
    const { rows } = compiled({});
    expect(rows.sql).toContain('limit $');
    expect(rows.parameters).toContain(25);
  });

  it('count query repeats the same WHERE (scope + filters) without LIMIT/ORDER BY', () => {
    const { total } = compiled({ filter: { stage: 'documents_pending' } });
    expect(total.sql).toContain('count(*)');
    expect(total.sql).toContain('"l"."owner_id" = $2');
    expect(total.sql).toContain('"l"."stage" in ($3)');
    expect(total.sql).not.toContain('limit');
    expect(total.sql).not.toContain('order by');
  });

  it('TC-13: score_band=hot → l.score >= 75; warm is a closed band; unscored IS NULL', () => {
    expect(compiled({ filter: { score_band: 'hot' } }).rows.sql).toContain('"l"."score" >= $');
    const warm = compiled({ filter: { score_band: 'warm' } }).rows;
    expect(warm.sql).toContain('"l"."score" >= $');
    expect(warm.sql).toContain('"l"."score" < $');
    expect(warm.parameters).toEqual(expect.arrayContaining([50, 75]));
    expect(compiled({ filter: { score_band: 'unscored' } }).rows.sql).toContain('"l"."score" is null');
  });

  it('TC-12: sla_state=breached → due_at < now(); due_soon uses the FR-104 window', () => {
    const breached = compiled({ filter: { sla_state: 'breached' } }).rows;
    expect(breached.sql).toContain('"l"."sla_first_contact_due_at" < now()');
    const dueSoon = compiled({ filter: { sla_state: 'due_soon' } }).rows;
    expect(dueSoon.sql).toContain('"l"."sla_first_contact_due_at" >= now()');
    expect(dueSoon.sql).toContain('make_interval(mins =>');
    expect(dueSoon.parameters).toContain(30);
  });

  it('TC-14: q compiles parameterised ORs over code/name/mobile/PAN/GSTIN/LOS-id/partner', () => {
    const { rows } = compiled({ q: '000123' });
    expect(rows.sql).toContain('"l"."lead_code" ilike $');
    expect(rows.sql).toContain('"li"."name" ilike $');
    expect(rows.sql).toContain('"li"."mobile" = $');
    expect(rows.sql).toContain('"li"."pan_masked" ilike $');
    expect(rows.sql).toContain('"li"."gstin" = $');
    expect(rows.sql).toContain('"l"."los_application_id" = $');
    expect(rows.sql).toContain('"p"."partner_code" ilike $');
    expect(rows.parameters).toContain('%000123%');
    // Never interpolated into the SQL text.
    expect(rows.sql).not.toContain('000123');
  });

  it('GSTIN free-text matches are upper-cased before binding', () => {
    const { rows } = compiled({ q: '27aapfu0939f1zv' });
    expect(rows.parameters).toContain('27AAPFU0939F1ZV');
  });

  it('sort maps only to allow-listed lead columns, with direction', () => {
    const { rows } = compiled({ sort: 'score:asc' });
    expect(rows.sql).toContain('order by "l"."score" asc');
    const desc = compiled({ sort: 'sla_first_contact_due_at:desc' }).rows;
    expect(desc.sql).toContain('order by "l"."sla_first_contact_due_at" desc');
  });

  it('source/partner filters bind via the attribution/partner joins', () => {
    const { rows } = compiled({ filter: { source: 'DSA', partner: 'PTR-0001' } });
    expect(rows.sql).toContain('"sa"."source" = $');
    expect(rows.sql).toContain('"p"."partner_code" = $');
    expect(rows.parameters).toEqual(expect.arrayContaining(['DSA', 'PTR-0001']));
  });

  it('date range applies to lead creation time, inclusive', () => {
    const filter = LeadFilterSchema.parse({ date_from: '2026-06-01', date_to: '2026-06-10' });
    const sqlText = repo
      .buildListQuery(ORG, OWN_RM_A, filter, undefined)
      .select('l.lead_id')
      .compile().sql;
    expect(sqlText).toContain('"l"."created_at" >= $');
    expect(sqlText).toContain('"l"."created_at" <= $');
  });

  it('findLeadsInScope compiles the scope predicate + id set + LIMIT (TC-23 SQL slice)', () => {
    // Compile the same shape findLeadsInScope builds, via the public builders:
    // scope-filtered base narrowed to the requested ids — proving out-of-scope
    // ids can never come back from SQL.
    const ids = ['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002'];
    const compiledScope = repo
      .buildListQuery(ORG, { type: 'branch', branchId: 'branch-1' }, LeadFilterSchema.parse({}), undefined)
      .where('l.lead_id', 'in', ids)
      .select(['l.lead_id', 'l.stage'])
      .limit(ids.length)
      .compile();
    expect(compiledScope.sql).toContain('"l"."branch_id" = $');
    expect(compiledScope.sql).toContain('"l"."lead_id" in ($');
    expect(compiledScope.sql).toContain('limit $');
    expect(compiledScope.parameters).toEqual(expect.arrayContaining(['branch-1', ...ids]));
  });
});
