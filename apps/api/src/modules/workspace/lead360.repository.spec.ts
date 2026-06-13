import type { ScopePredicate } from '@lms/shared';

import {
  CONSENT_FETCH_LIMIT,
  DUPLICATE_MATCHES_LIMIT,
  Lead360Repository,
  NOTES_LIMIT,
  STAGE_HISTORY_LIMIT,
} from './lead360.repository';
import { LeadScopeService } from './lead-scope.service';
import { compileOnlyDb } from './lead-scope.service.spec';

/**
 * FR-051 — compile-level component tests for the ten LLD queries (the SQL the
 * deferred Testcontainers tier would execute): the ABAC scope predicate is
 * compiled INTO the core WHERE (TC-051-03/08 — out-of-scope/cross-partner rows
 * are never read), soft-delete is always filtered (TC-051-10), raw PII columns
 * are never selected, and every child query is LIMIT-bounded. Queries are
 * compiled only — never executed.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const RM_A = 'a0000000-0000-4000-8000-00000000000a';
const PARTNER_ID = 'c0000000-0000-4000-8000-00000000000c';
const LEAD_ID = 'f6b7c1de-0000-4000-8000-000000000051';
const OWN_RM_A: ScopePredicate = { type: 'own', userId: RM_A };

describe('Lead360Repository query assembly', () => {
  const repo = new Lead360Repository(compileOnlyDb(), new LeadScopeService());

  describe('core query (LLD step 1)', () => {
    it('TC-051-03 analogue: org + deleted_at + scope predicate + lead_id are ALL in the WHERE', () => {
      const { sql, parameters } = repo.buildCoreQuery(ORG, OWN_RM_A, LEAD_ID).compile();
      expect(sql).toContain('"l"."org_id" = $1');
      expect(sql).toContain('"l"."deleted_at" is null'); // TC-051-10 (soft delete)
      expect(sql).toContain('"l"."owner_id" = $2'); // RM scope in SQL
      expect(sql).toContain('"l"."lead_id" = $3');
      expect(parameters).toEqual(expect.arrayContaining([ORG, RM_A, LEAD_ID]));
    });

    it('TC-051-08 analogue: PARTNER scope compiles to sa.partner_id = caller partner', () => {
      const { sql, parameters } = repo
        .buildCoreQuery(ORG, { type: 'partner', partnerId: PARTNER_ID }, LEAD_ID)
        .compile();
      expect(sql).toContain('"sa"."partner_id" = $2');
      expect(parameters).toContain(PARTNER_ID);
    });

    it('a missing predicate compiles to a FALSE predicate (deny-by-default, no row readable)', () => {
      const { sql, parameters } = repo.buildCoreQuery(ORG, undefined, LEAD_ID).compile();
      // LeadScopeService binds `eb.val(false)` — an always-false AND parameter.
      expect(sql).toContain('and $2 and');
      expect(parameters[1]).toBe(false);
    });

    it('is LIMIT-bounded and selects ONLY the LLD column list — never raw PII tokens', () => {
      const { sql, parameters } = repo.buildCoreQuery(ORG, OWN_RM_A, LEAD_ID).compile();
      expect(sql).toContain('limit $');
      expect(parameters).toContain(1);
      expect(sql).not.toContain('select *');
      for (const col of [
        '"l"."lead_code"',
        '"l"."stage"',
        '"l"."score_reasons"',
        '"li"."name"',
        '"li"."mobile"',
        '"li"."pan_masked"',
        '"li"."dob"',
        '"cp"."display_name"',
        '"sa"."partner_id"',
        '"lpd"."validation_status"',
        '"b"."name" as "branch_name"',
        '"owner"."full_name" as "owner_full_name"',
        '"t"."name" as "team_name"',
        '"p"."partner_code"',
      ]) {
        expect(sql).toContain(col);
      }
      // FR-002: tokenised/unmaskable PII is never selected by the 360 read.
      expect(sql).not.toContain('pan_token');
      expect(sql).not.toContain('aadhaar_ref_token');
      expect(sql).not.toContain('ckyc_id');
      expect(sql).not.toContain('"li"."address"');
    });
  });

  it('step 2: stage history is lead-bound, occurred_at DESC, LIMIT 20', () => {
    const { sql, parameters } = repo.buildStageHistoryQuery(LEAD_ID).compile();
    expect(sql).toContain('"lead_id" = $1');
    expect(sql).toContain('order by "occurred_at" desc');
    expect(sql).toContain('limit $');
    expect(parameters).toEqual([LEAD_ID, STAGE_HISTORY_LIMIT]);
  });

  it('step 3: eligibility snapshot takes the single newest row (created_at DESC LIMIT 1)', () => {
    const { sql, parameters } = repo.buildEligibilityQuery(LEAD_ID).compile();
    expect(sql).toContain('order by "created_at" desc');
    expect(parameters).toEqual([LEAD_ID, 1]);
  });

  it('step 4: LOS mirror takes the single newest row (status_date DESC LIMIT 1)', () => {
    const { sql, parameters } = repo.buildLosMirrorQuery(LEAD_ID).compile();
    expect(sql).toContain('order by "status_date" desc');
    expect(parameters).toEqual([LEAD_ID, 1]);
  });

  it('step 5: document counts GROUP BY status over active (deleted_at IS NULL) docs, bounded', () => {
    const { sql, parameters } = repo.buildDocumentCountsQuery(LEAD_ID).compile();
    expect(sql).toContain('count("document_id")');
    expect(sql).toContain('"deleted_at" is null');
    expect(sql).toContain('group by "status"');
    expect(sql).toContain('limit $');
    expect(parameters).toContain(LEAD_ID);
  });

  it('step 6: KYC counts GROUP BY status, bounded', () => {
    const { sql, parameters } = repo.buildKycCountsQuery(LEAD_ID).compile();
    expect(sql).toContain('count("kyc_verification_id")');
    expect(sql).toContain('group by "status"');
    expect(sql).toContain('limit $');
    expect(parameters).toContain(LEAD_ID);
  });

  it("step 7: open-task count excludes done/cancelled ('status' NOT IN)", () => {
    const { sql, parameters } = repo.buildOpenTaskCountQuery(LEAD_ID).compile();
    expect(sql).toContain('count("task_id")');
    expect(sql).toContain('"status" not in ($2, $3)');
    expect(parameters).toEqual([LEAD_ID, 'done', 'cancelled']);
  });

  it('step 8: consent rows are newest-first and bounded by the platform list maximum', () => {
    const { sql, parameters } = repo.buildConsentRowsQuery(LEAD_ID).compile();
    expect(sql).toContain('order by "created_at" desc');
    expect(parameters).toEqual([LEAD_ID, CONSENT_FETCH_LIMIT]);
  });

  describe('step 9: notes', () => {
    it('internal callers: latest 10 desc, no internal filter', () => {
      const { sql, parameters } = repo.buildNotesQuery(LEAD_ID, false).compile();
      expect(sql).toContain('order by "created_at" desc');
      expect(sql).not.toContain('"is_internal" =');
      expect(parameters).toEqual([LEAD_ID, NOTES_LIMIT]);
    });

    it('TC-051-09: PARTNER callers add is_internal = false IN SQL', () => {
      const { sql, parameters } = repo.buildNotesQuery(LEAD_ID, true).compile();
      expect(sql).toContain('"is_internal" = $');
      expect(parameters).toEqual(expect.arrayContaining([LEAD_ID, false, NOTES_LIMIT]));
    });
  });

  it('step 10: duplicate matches join the matched lead code, open-only, org-scoped, LIMIT 5', () => {
    const { sql, parameters } = repo.buildDuplicateMatchesQuery(LEAD_ID, ORG).compile();
    expect(sql).toContain('inner join "leads" as "ml"');
    expect(sql).toContain('"ml"."lead_code" as "matched_lead_code"');
    expect(sql).toContain('"dm"."status" = $');
    // Fix 3: matched lead must be constrained to the same org (cross-org leak prevention).
    expect(sql).toContain('"ml"."org_id" = $');
    expect(parameters).toEqual(expect.arrayContaining([LEAD_ID, 'open', ORG, DUPLICATE_MATCHES_LIMIT]));
  });
});
