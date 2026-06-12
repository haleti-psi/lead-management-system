import { ERROR_CODES, type ScopePredicate } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import type { DbTransaction, KyselyDb, UnitOfWork } from '../../core/db';
import { isDomainException } from '../../core/http';
import type { OutboxService } from '../../core/outbox';
import { SYSTEM_ACTOR_ID } from '../capture/capture.constants';
import type { LeadService } from '../capture/lead.service';
import { DuplicateBlockedException } from './dedupe.errors';
import type {
  CandidateLeadRow,
  DedupeLeadContext,
  DedupeRepository,
  ExistingMatchRow,
} from './dedupe.repository';
import {
  DuplicateService,
  collectCandidates,
  leadInScope,
  resolveAction,
  scoreAndRank,
  type CandidateWithHits,
  type MatchKeyHit,
  type ScoredMatch,
} from './dedupe.service';
import { DuplicateCheckAdapter } from './duplicate-check.adapter';
import { DuplicateCheckDto } from './dto/duplicate-check.dto';

/**
 * FR-020 unit + component tests (FR-020-tests.md): T01–T10 against the pure
 * scoring engine, plus service-level analogues of the deferred API tier —
 * T11–T15/T17/T19–T23/T25–T29 with the AbacGuard predicate mocked and
 * repositories stubbed, T30 + the port adapter contract. T16 is exercised at
 * the Zod layer (the same schema the controller pipe runs); T18/T24's
 * full-HTTP guard/interceptor behaviour is the deferred Testcontainers wave
 * (manifest stage7.test_strategy) — the masking-relevant response SHAPE is
 * asserted here.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const MATCHED = 'c0000000-0000-0000-0000-00000000000c';
const MASTER = 'a0000000-0000-0000-0000-00000000000a';
const TX = { __tx: true } as unknown as DbTransaction;

// ── builders ─────────────────────────────────────────────────────────────────

function leadCtx(overrides: Partial<DedupeLeadContext> = {}): DedupeLeadContext {
  return {
    lead_id: LEAD,
    org_id: ORG,
    lead_code: 'LD-2026-000123',
    stage: 'captured',
    branch_id: 'branch-1',
    owner_id: 'rm-1',
    team_id: 'team-1',
    duplicate_status: 'none',
    version: 3,
    product_code: 'CV',
    pin_code: '400001',
    master_lead_id: null,
    lead_identity_id: 'li-1',
    mobile: '9876543210',
    pan_token: null,
    ckyc_id: null,
    gstin: null,
    name: 'Asha Kumar',
    source: 'DSA',
    partner_id: null,
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<CandidateLeadRow> = {}): CandidateLeadRow {
  return {
    lead_id: id,
    lead_code: 'LD-2026-000050',
    stage: 'assigned',
    master_lead_id: null,
    master_lead_code: null,
    branch_id: 'branch-1',
    pin_code: '400001',
    product_code: 'CV',
    mobile: '9876543210',
    pan_token: null,
    name: 'Asha Kumari',
    pan_masked: 'ABCxxxx1F',
    ...overrides,
  };
}

function withHits(row: CandidateLeadRow, ...hits: MatchKeyHit[]): CandidateWithHits {
  return { row, hits: new Set(hits) };
}

function makeUser(role: AuthUser['role'], userId = 'actor-1'): AuthUser {
  return { userId, orgId: ORG, role, scope: 'O', jti: 'jti-1' };
}

const ownPredicate = (userId: string): ScopePredicate => ({ type: 'own', userId });
const branchPredicate = (branchId: string): ScopePredicate => ({ type: 'branch', branchId });
const teamPredicate = (...userIds: string[]): ScopePredicate => ({ type: 'team', userIds });

interface Harness {
  service: DuplicateService;
  repo: {
    findLeadContext: jest.Mock;
    findByPan: jest.Mock;
    findByMobile: jest.Mock;
    findByCkyc: jest.Mock;
    findByGstin: jest.Mock;
    findByFuzzyName: jest.Mock;
    findExistingMatches: jest.Mock;
    upsertMatches: jest.Mock;
  };
  leads: { recomputeDuplicateStatus: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
  uowRun: jest.Mock;
  logger: { warn: jest.Mock; error: jest.Mock; info: jest.Mock; debug: jest.Mock };
}

function makeHarness(): Harness {
  const repo = {
    findLeadContext: jest.fn().mockResolvedValue(leadCtx()),
    findByPan: jest.fn().mockResolvedValue([]),
    findByMobile: jest.fn().mockResolvedValue([]),
    findByCkyc: jest.fn().mockResolvedValue([]),
    findByGstin: jest.fn().mockResolvedValue([]),
    findByFuzzyName: jest.fn().mockResolvedValue([]),
    findExistingMatches: jest.fn().mockResolvedValue(new Map<string, ExistingMatchRow>()),
    upsertMatches: jest.fn().mockResolvedValue(new Map([[MATCHED, 'dm-1']])),
  };
  const leads = { recomputeDuplicateStatus: jest.fn().mockResolvedValue('flagged') };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const outbox = { emit: jest.fn().mockResolvedValue(undefined) };
  const uowRun = jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX));
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };

  const service = new DuplicateService(
    {} as unknown as KyselyDb,
    { run: uowRun } as unknown as UnitOfWork,
    repo as unknown as DedupeRepository,
    leads as unknown as LeadService,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
    logger as never,
  );
  return { service, repo, leads, audit, outbox, uowRun, logger };
}

async function rejectsDomain(promise: Promise<unknown>, code: string): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    if (!isDomainException(err)) throw err;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected DomainException(${code}) but the promise resolved`);
}

// ── T01–T10 — the BRD default-match table (pure scoring engine) ──────────────

describe('scoreAndRank (BRD default-match table)', () => {
  it('T01: same PAN + same mobile scores strong/blocked on [pan_token, mobile]', () => {
    const [match] = scoreAndRank([withHits(candidate(MATCHED), 'pan', 'mobile')], LEAD);
    expect(match).toMatchObject({
      matched_lead_id: MATCHED,
      confidence: 'strong',
      action: 'blocked',
      matched_on: ['pan_token', 'mobile'],
    });
  });

  it('T02: same PAN with a different mobile scores strong/warned (identity review)', () => {
    const [match] = scoreAndRank([withHits(candidate(MATCHED), 'pan')], LEAD);
    expect(match).toMatchObject({ confidence: 'strong', action: 'warned', matched_on: ['pan_token'] });
  });

  it('T03: same mobile with no PAN on either scores medium/warned', () => {
    const [match] = scoreAndRank(
      [withHits(candidate(MATCHED, { pan_token: null }), 'mobile')],
      LEAD,
    );
    expect(match).toMatchObject({ confidence: 'medium', action: 'warned', matched_on: ['mobile'] });
  });

  it('T04: same CKYC id scores strong/blocked', () => {
    const [match] = scoreAndRank([withHits(candidate(MATCHED), 'ckyc')], LEAD);
    expect(match).toMatchObject({ confidence: 'strong', action: 'blocked', matched_on: ['ckyc_id'] });
  });

  it('T05: same GSTIN + same product scores medium/warned on [gstin, product_code]', () => {
    const [match] = scoreAndRank([withHits(candidate(MATCHED), 'gstin')], LEAD);
    expect(match).toMatchObject({
      confidence: 'medium',
      action: 'warned',
      matched_on: ['gstin', 'product_code'],
    });
  });

  it('T06: trigram name + same pin + same source scores weak/warned', () => {
    const [match] = scoreAndRank([withHits(candidate(MATCHED), 'fuzzy')], LEAD);
    expect(match).toMatchObject({
      confidence: 'weak',
      action: 'warned',
      matched_on: ['name', 'pin_code', 'source'],
    });
  });

  it('T07: with multiple matches the highest-confidence match drives the action', () => {
    const matches = scoreAndRank(
      [
        withHits(candidate('d0000000-0000-0000-0000-00000000000d', { lead_code: 'LD-2026-000222' }), 'fuzzy'),
        withHits(candidate(MATCHED), 'pan', 'mobile'),
      ],
      LEAD,
    );
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ matched_lead_id: MATCHED, confidence: 'strong' });
    expect(resolveAction(matches, undefined)).toBe('blocked');
  });

  it('T08: a matched lead with master_lead_id resolves to the master, inheriting confidence', () => {
    const [match] = scoreAndRank(
      [
        withHits(
          candidate(MATCHED, { master_lead_id: MASTER, master_lead_code: 'LD-2025-000001' }),
          'pan',
        ),
      ],
      LEAD,
    );
    expect(match).toMatchObject({
      matched_lead_id: MASTER,
      matched_lead_code: 'LD-2025-000001',
      confidence: 'strong',
      action: 'warned',
    });
  });

  it('T09: no key hit yields no matches', () => {
    expect(scoreAndRank([], LEAD)).toEqual([]);
    expect(collectCandidates([['mobile', []], ['pan', []]])).toEqual([]);
  });

  it('T10: a requested override resolves to overridden (clears the block, no throw)', () => {
    const matches = scoreAndRank([withHits(candidate(MATCHED), 'pan', 'mobile')], LEAD);
    expect(resolveAction(matches, 'override')).toBe('overridden');
  });

  it('keeps the strongest tier when one candidate matches several rules', () => {
    const [match] = scoreAndRank([withHits(candidate(MATCHED), 'ckyc', 'pan', 'mobile', 'fuzzy')], LEAD);
    expect(match).toMatchObject({ confidence: 'strong', action: 'blocked' });
    expect(match.matched_on).toEqual(['pan_token', 'mobile', 'ckyc_id']);
  });

  it('de-duplicates a master matched both directly and via its duplicate, keeping highest confidence', () => {
    const matches = scoreAndRank(
      [
        withHits(candidate(MASTER, { lead_code: 'LD-2025-000001' }), 'fuzzy'),
        withHits(
          candidate(MATCHED, { master_lead_id: MASTER, master_lead_code: 'LD-2025-000001' }),
          'pan',
        ),
      ],
      LEAD,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ matched_lead_id: MASTER, confidence: 'strong' });
  });

  it('never emits a self-pair (candidate whose master is the checked lead — ck_dup_distinct)', () => {
    const matches = scoreAndRank(
      [withHits(candidate(MATCHED, { master_lead_id: LEAD, master_lead_code: 'LD-2026-000123' }), 'mobile')],
      LEAD,
    );
    expect(matches).toEqual([]);
  });

  it('a strong block yields only to override — weaker requested actions stay blocked', () => {
    const matches = scoreAndRank([withHits(candidate(MATCHED), 'pan', 'mobile')], LEAD);
    expect(resolveAction(matches, 'warn')).toBe('blocked');
    expect(resolveAction(matches, 'queue')).toBe('blocked');
    expect(resolveAction(matches, 'link')).toBe('blocked');
  });

  it('maps requested queue/link/block over a non-blocking default', () => {
    const matches = scoreAndRank([withHits(candidate(MATCHED), 'mobile')], LEAD);
    expect(resolveAction(matches, 'queue')).toBe('queued');
    expect(resolveAction(matches, 'link')).toBe('linked');
    expect(resolveAction(matches, 'block')).toBe('blocked');
    expect(resolveAction(matches, 'warn')).toBe('warned');
  });
});

describe('leadInScope (row-level ABAC per the guard predicate)', () => {
  const lead = { owner_id: 'rm-1', branch_id: 'branch-1' };

  it('grants own/team/branch/all predicates that contain the lead', () => {
    expect(leadInScope(lead, ownPredicate('rm-1'))).toBe(true);
    expect(leadInScope(lead, teamPredicate('rm-1', 'rm-2'))).toBe(true);
    expect(leadInScope(lead, branchPredicate('branch-1'))).toBe(true);
    expect(leadInScope(lead, { type: 'all', orgId: ORG })).toBe(true);
  });

  it('denies out-of-scope, unowned-for-own/team, and missing predicates', () => {
    expect(leadInScope(lead, ownPredicate('rm-2'))).toBe(false);
    expect(leadInScope(lead, teamPredicate('rm-9'))).toBe(false);
    expect(leadInScope(lead, branchPredicate('branch-2'))).toBe(false);
    expect(leadInScope({ owner_id: null, branch_id: null }, ownPredicate('rm-1'))).toBe(false);
    expect(leadInScope(lead, undefined)).toBe(false);
    expect(leadInScope(lead, { type: 'masked', orgId: ORG })).toBe(false);
  });
});

// ── T11–T29 service-level analogues — POST /leads/{id}/duplicate-check ──────

describe('DuplicateService.check', () => {
  const rm = makeUser('RM', 'rm-1');
  const rmScope = { predicate: ownPredicate('rm-1') };

  it('T11: returns duplicate_status none with no matches and writes nothing', async () => {
    const h = makeHarness();
    const result = await h.service.check(LEAD, {}, rm, rmScope);
    expect(result).toEqual({ lead_id: LEAD, duplicate_status: 'none', action_taken: null, matches: [] });
    expect(h.uowRun).not.toHaveBeenCalled();
    expect(h.repo.upsertMatches).not.toHaveBeenCalled();
    expect(h.audit.append).not.toHaveBeenCalled();
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  it('T12: a medium mobile match is persisted as warned/open with audit + outbox in the same tx', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);

    const result = await h.service.check(LEAD, {}, rm, rmScope);

    expect(result.action_taken).toBe('warned');
    expect(result.duplicate_status).toBe('flagged');
    expect(result.matches[0]).toMatchObject({
      duplicate_match_id: 'dm-1',
      matched_lead_id: MATCHED,
      matched_lead_code: 'LD-2026-000050',
      confidence: 'medium',
      matched_on: ['mobile'],
      action: 'warned',
      status: 'open',
    });
    // one upserted row, in the UnitOfWork tx, with the table-default action
    expect(h.repo.upsertMatches).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          org_id: ORG,
          lead_id: LEAD,
          matched_lead_id: MATCHED,
          confidence: 'medium',
          action: 'warned',
          action_by: null,
          action_reason: null,
          actor_id: 'rm-1',
        }),
      ],
      TX,
    );
    // duplicate_status recomputed by the SOLE writer of `leads`, same tx
    expect(h.leads.recomputeDuplicateStatus).toHaveBeenCalledWith(LEAD, ORG, 'rm-1', 3, TX);
    // audit + outbox in the SAME tx (architecture §11)
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead_update',
        entity_type: 'leads',
        entity_id: LEAD,
        actor_id: 'rm-1',
        lead_id: LEAD,
        detail: expect.objectContaining({ fr: 'FR-020', action_taken: 'warned', match_count: 1 }),
      }),
      TX,
    );
    expect(h.outbox.emit).toHaveBeenCalledWith(
      {
        event_code: 'DUPLICATE_FLAGGED',
        aggregate_type: 'leads',
        aggregate_id: LEAD,
        payload: expect.objectContaining({ lead_id: LEAD, duplicate_status: 'flagged', action: 'warned' }),
      },
      TX,
    );
  });

  it('T13: a strong block without override raises 409 DUPLICATE_BLOCKED before any write', async () => {
    const h = makeHarness();
    h.repo.findByPan.mockResolvedValue([candidate(MATCHED, { pan_token: 'tok_pan_1' })]);
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED, { pan_token: 'tok_pan_1' })]);
    h.repo.findLeadContext.mockResolvedValue(leadCtx({ pan_token: 'tok_pan_1' }));

    const err = await rejectsDomain(h.service.check(LEAD, {}, rm, rmScope), ERROR_CODES.CONFLICT);
    expect(err).toBeInstanceOf(DuplicateBlockedException);
    const detail = (err as DuplicateBlockedException).detail;
    expect(detail).toMatchObject({ reason: 'DUPLICATE_BLOCKED', override_allowed_by: ['BM', 'SM'] });
    expect(detail?.['matches']).toEqual([
      {
        matched_lead_id: MATCHED,
        matched_lead_code: 'LD-2026-000050',
        confidence: 'strong',
        matched_on: ['pan_token', 'mobile'],
      },
    ]);
    expect((err as DuplicateBlockedException).httpStatus).toBe(409);
    // leads.duplicate_status unchanged — nothing was written
    expect(h.uowRun).not.toHaveBeenCalled();
    expect(h.repo.upsertMatches).not.toHaveBeenCalled();
    expect(h.leads.recomputeDuplicateStatus).not.toHaveBeenCalled();
    expect(h.audit.append).not.toHaveBeenCalled();
  });

  it('T14: a BM override of a strong block persists overridden rows and a lead_override audit', async () => {
    const h = makeHarness();
    const bm = makeUser('BM', 'bm-1');
    h.repo.findByPan.mockResolvedValue([candidate(MATCHED)]);
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);
    h.repo.findLeadContext.mockResolvedValue(leadCtx({ pan_token: 'tok_pan_1' }));
    h.leads.recomputeDuplicateStatus.mockResolvedValue('none'); // override clears the flag

    const result = await h.service.check(
      LEAD,
      { requested_action: 'override', override_reason: 'Verified same customer, second product' },
      bm,
      { predicate: branchPredicate('branch-1') },
    );

    expect(result.action_taken).toBe('overridden');
    expect(result.duplicate_status).toBe('none');
    expect(h.repo.upsertMatches).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: 'overridden',
          action_by: 'bm-1',
          action_reason: 'Verified same customer, second product',
        }),
      ],
      TX,
    );
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead_override',
        actor_id: 'bm-1',
        detail: expect.objectContaining({
          action_taken: 'overridden',
          override_reason: 'Verified same customer, second product',
        }),
      }),
      TX,
    );
  });

  it('T15: an RM override attempt is FORBIDDEN, audited as a deny, and writes no match rows', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);

    await rejectsDomain(
      h.service.check(LEAD, { requested_action: 'override', override_reason: 'please' }, rm, rmScope),
      ERROR_CODES.FORBIDDEN,
    );
    expect(h.repo.upsertMatches).not.toHaveBeenCalled();
    expect(h.uowRun).not.toHaveBeenCalled();
    // audited (LLD §Auth) — as a deny, never as lead_override
    expect(h.audit.append).toHaveBeenCalledTimes(1);
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'abac_deny', detail: expect.objectContaining({ denied: true }) }),
    );
  });

  it('T17: an out-of-scope RM (another RM\'s lead) is FORBIDDEN with no DB writes', async () => {
    const h = makeHarness();
    h.repo.findLeadContext.mockResolvedValue(leadCtx({ owner_id: 'rm-2' }));

    await rejectsDomain(h.service.check(LEAD, {}, rm, rmScope), ERROR_CODES.FORBIDDEN);
    expect(h.repo.findByMobile).not.toHaveBeenCalled();
    expect(h.repo.upsertMatches).not.toHaveBeenCalled();
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('T19: an unknown or soft-deleted lead is NOT_FOUND', async () => {
    const h = makeHarness();
    h.repo.findLeadContext.mockResolvedValue(undefined);
    await rejectsDomain(h.service.check(LEAD, {}, rm, rmScope), ERROR_CODES.NOT_FOUND);
  });

  it('T20: a terminal lead (handed_off / rejected) is a VALIDATION_ERROR referencing the stage', async () => {
    const h = makeHarness();
    h.repo.findLeadContext.mockResolvedValue(leadCtx({ stage: 'handed_off' }));
    const err = await rejectsDomain(h.service.check(LEAD, {}, rm, rmScope), ERROR_CODES.VALIDATION_ERROR);
    expect((err as Error).message).toContain('terminal');

    h.repo.findLeadContext.mockResolvedValue(leadCtx({ stage: 'rejected' }));
    await rejectsDomain(h.service.check(LEAD, {}, rm, rmScope), ERROR_CODES.VALIDATION_ERROR);
    expect(h.repo.findByMobile).not.toHaveBeenCalled();
  });

  it('T21: a stale leads.version surfaces the sole-writer CONFLICT and skips audit/outbox', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);
    h.leads.recomputeDuplicateStatus.mockRejectedValue(
      Object.assign(new Error('stale'), { code: ERROR_CODES.CONFLICT }),
    );

    await expect(h.service.check(LEAD, {}, rm, rmScope)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    // ordered inside ONE UnitOfWork tx — the throw aborts it before audit/outbox
    expect(h.uowRun).toHaveBeenCalledTimes(1);
    expect(h.audit.append).not.toHaveBeenCalled();
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  it('T22: a mid-transaction failure propagates (UnitOfWork rolls the whole write set back)', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);
    h.audit.append.mockRejectedValue(new Error('audit store down'));

    await expect(h.service.check(LEAD, {}, rm, rmScope)).rejects.toThrow('audit store down');
    expect(h.uowRun).toHaveBeenCalledTimes(1); // single atomic tx — rollback on throw
  });

  it('T23: an identical re-check upserts (refresh) but writes no second audit or outbox row', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);
    h.repo.findExistingMatches.mockResolvedValue(
      new Map<string, ExistingMatchRow>([
        [
          MATCHED,
          {
            duplicate_match_id: 'dm-1',
            matched_lead_id: MATCHED,
            confidence: 'medium',
            action: 'warned',
            status: 'open',
          },
        ],
      ]),
    );

    const result = await h.service.check(LEAD, {}, rm, rmScope);

    expect(h.repo.upsertMatches).toHaveBeenCalledTimes(1); // refresh via uq_dup_pair
    expect(result.matches[0]?.duplicate_match_id).toBe('dm-1'); // id unchanged
    expect(h.audit.append).not.toHaveBeenCalled(); // INV-07
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  it('T24 analogue: match rows expose only display identity (pan_masked/mobile/name) — never pan_token', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED, { pan_token: 'tok_secret' })]);

    const result = await h.service.check(LEAD, {}, rm, rmScope);
    const match = result.matches[0];
    expect(match.pan_masked).toBe('ABCxxxx1F');
    expect(match.mobile).toBe('9876543210'); // masked downstream by MaskingInterceptor FIELD_MAP
    expect(match.name).toBe('Asha Kumari');
    expect(Object.keys(match)).not.toContain('pan_token');
  });

  it('T25/T26: BM branch scope grants own-branch leads and denies other branches', async () => {
    const h = makeHarness();
    const bm = makeUser('BM', 'bm-1');
    await expect(
      h.service.check(LEAD, {}, bm, { predicate: branchPredicate('branch-1') }),
    ).resolves.toMatchObject({ duplicate_status: 'none' });

    await rejectsDomain(
      h.service.check(LEAD, {}, bm, { predicate: branchPredicate('branch-2') }),
      ERROR_CODES.FORBIDDEN,
    );
  });

  it('T27: a KYC queue request persists queued rows; an RM queue request is FORBIDDEN', async () => {
    const h = makeHarness();
    const kyc = makeUser('KYC', 'kyc-1');
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);

    const result = await h.service.check(LEAD, { requested_action: 'queue' }, kyc, {
      predicate: branchPredicate('branch-1'),
    });
    expect(result.action_taken).toBe('queued');
    expect(result.duplicate_status).toBe('flagged');
    expect(h.repo.upsertMatches).toHaveBeenCalledWith(
      [expect.objectContaining({ action: 'queued' })],
      TX,
    );

    await rejectsDomain(
      h.service.check(LEAD, { requested_action: 'queue' }, rm, rmScope),
      ERROR_CODES.FORBIDDEN,
    );
  });

  it('T28: GSTIN + product match runs the product-scoped query and scores medium', async () => {
    const h = makeHarness();
    h.repo.findLeadContext.mockResolvedValue(leadCtx({ gstin: '27AAPFU0939F1ZV', product_code: 'SBL' }));
    h.repo.findByGstin.mockResolvedValue([candidate(MATCHED, { product_code: 'SBL' })]);

    const result = await h.service.check(LEAD, {}, rm, rmScope);
    expect(h.repo.findByGstin).toHaveBeenCalledWith('27AAPFU0939F1ZV', 'SBL', ORG, LEAD, expect.anything());
    expect(result.matches[0]).toMatchObject({
      confidence: 'medium',
      matched_on: ['gstin', 'product_code'],
    });
  });

  it('T29: a fuzzy name + pin + source match flags the lead with weak confidence', async () => {
    const h = makeHarness();
    h.repo.findByFuzzyName.mockResolvedValue([candidate(MATCHED)]);

    const result = await h.service.check(LEAD, {}, rm, rmScope);
    expect(h.repo.findByFuzzyName).toHaveBeenCalledWith(
      'Asha Kumar',
      '400001',
      'DSA',
      ORG,
      LEAD,
      expect.anything(),
    );
    expect(result.matches[0]).toMatchObject({ confidence: 'weak', action: 'warned' });
    expect(result.duplicate_status).toBe('flagged');
  });

  it('skips the PAN/CKYC/GSTIN/fuzzy queries when the lead lacks those keys', async () => {
    const h = makeHarness();
    h.repo.findLeadContext.mockResolvedValue(leadCtx({ pin_code: null, source: null }));
    await h.service.check(LEAD, {}, rm, rmScope);
    expect(h.repo.findByMobile).toHaveBeenCalledTimes(1);
    expect(h.repo.findByPan).not.toHaveBeenCalled();
    expect(h.repo.findByCkyc).not.toHaveBeenCalled();
    expect(h.repo.findByGstin).not.toHaveBeenCalled();
    expect(h.repo.findByFuzzyName).not.toHaveBeenCalled();
  });
});

// ── T30 + adapter — the FR-010 intake gate over the frozen port contract ────

describe('DuplicateService.match (intake gate) and DuplicateCheckAdapter', () => {
  it('T30: a strong PAN+mobile pair at intake throws DuplicateBlockedException (no lead persisted)', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED, { pan_token: 'tok_pan_1' })]);
    h.repo.findByPan.mockResolvedValue([candidate(MATCHED, { pan_token: 'tok_pan_1' })]);

    await expect(
      h.service.match({ mobile: '9876543210', pan_token: 'tok_pan_1', name: 'Asha' }, ORG, TX),
    ).rejects.toBeInstanceOf(DuplicateBlockedException);
    // gate is read-only — blocking persists nothing
    expect(h.repo.upsertMatches).not.toHaveBeenCalled();
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('returns non-blocking matches through the port result (warn-tier intake)', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);

    const result = await h.service.match({ mobile: '9876543210', pan_token: null }, ORG, TX);
    expect(result.blocked).toBe(false);
    expect(result.matches).toEqual([
      {
        lead_id: MATCHED,
        lead_code: 'LD-2026-000050',
        confidence: 'medium',
        matched_on: ['mobile'],
      },
    ]);
    expect(h.repo.findByPan).not.toHaveBeenCalled(); // no PAN to probe
  });

  it('adapter.matchSync translates the blocked throw into the frozen port shape', async () => {
    const scored: ScoredMatch[] = scoreAndRank([withHits(candidate(MATCHED), 'pan', 'mobile')], null);
    const service = {
      match: jest.fn().mockRejectedValue(new DuplicateBlockedException(scored)),
      scan: jest.fn(),
    };
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const adapter = new DuplicateCheckAdapter(service as unknown as DuplicateService, logger as never);

    const result = await adapter.matchSync({ mobile: '9876543210' }, ORG, TX);
    expect(result.blocked).toBe(true);
    expect(result.matches).toEqual([
      {
        lead_id: MATCHED,
        lead_code: 'LD-2026-000050',
        confidence: 'strong',
        matched_on: ['pan_token', 'mobile'],
      },
    ]);
  });

  it('adapter.matchSync rethrows non-duplicate errors and passes clean results through', async () => {
    const clean = { blocked: false, matches: [] };
    const service = { match: jest.fn().mockResolvedValue(clean), scan: jest.fn() };
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const adapter = new DuplicateCheckAdapter(service as unknown as DuplicateService, logger as never);

    await expect(adapter.matchSync({ mobile: '9' }, ORG, TX)).resolves.toBe(clean);

    service.match.mockRejectedValue(new Error('db down'));
    await expect(adapter.matchSync({ mobile: '9' }, ORG, TX)).rejects.toThrow('db down');
  });

  it('adapter.matchAsync never throws into the post-commit path (logs instead)', async () => {
    const service = { match: jest.fn(), scan: jest.fn().mockRejectedValue(new Error('scan down')) };
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const adapter = new DuplicateCheckAdapter(service as unknown as DuplicateService, logger as never);

    await expect(adapter.matchAsync(LEAD)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: LEAD }),
      expect.stringContaining('scan failed'),
    );
  });
});

// ── post-commit scan (capture step 5j) ───────────────────────────────────────

describe('DuplicateService.scan', () => {
  it('persists the table-default outcome as the system actor inside one UnitOfWork tx', async () => {
    const h = makeHarness();
    h.repo.findByMobile.mockResolvedValue([candidate(MATCHED)]);

    await h.service.scan(LEAD);

    expect(h.uowRun).toHaveBeenCalledTimes(1);
    expect(h.repo.upsertMatches).toHaveBeenCalledWith(
      [expect.objectContaining({ action: 'warned', actor_id: SYSTEM_ACTOR_ID })],
      TX,
    );
    expect(h.leads.recomputeDuplicateStatus).toHaveBeenCalledWith(LEAD, ORG, SYSTEM_ACTOR_ID, 3, TX);
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead_update', actor_id: SYSTEM_ACTOR_ID }),
      TX,
    );
    expect(h.outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_code: 'DUPLICATE_FLAGGED' }),
      TX,
    );
  });

  it('is a logged no-op for a missing lead and silent for a terminal lead', async () => {
    const h = makeHarness();
    h.repo.findLeadContext.mockResolvedValue(undefined);
    await h.service.scan(LEAD);
    expect(h.logger.warn).toHaveBeenCalled();

    h.repo.findLeadContext.mockResolvedValue(leadCtx({ stage: 'handed_off' }));
    await h.service.scan(LEAD);
    expect(h.repo.findByMobile).not.toHaveBeenCalled();
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('writes nothing when the scan finds no candidates', async () => {
    const h = makeHarness();
    await h.service.scan(LEAD);
    expect(h.uowRun).not.toHaveBeenCalled();
    expect(h.repo.upsertMatches).not.toHaveBeenCalled();
  });
});

// ── T16 + body validation — the schema the controller pipe runs ─────────────

describe('DuplicateCheckDto (Zod boundary)', () => {
  it('T16: override without override_reason fails on the override_reason field', () => {
    const result = DuplicateCheckDto.safeParse({ requested_action: 'override' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'override_reason');
      expect(issue?.message).toBe('Override reason is required and must not be blank.');
    }
  });

  it('rejects a blank or over-long override_reason', () => {
    expect(
      DuplicateCheckDto.safeParse({ requested_action: 'override', override_reason: '   ' }).success,
    ).toBe(false);
    expect(
      DuplicateCheckDto.safeParse({ requested_action: 'override', override_reason: 'x'.repeat(501) })
        .success,
    ).toBe(false);
  });

  it('accepts a valid override and a missing/empty body (internal no-body re-check)', () => {
    expect(
      DuplicateCheckDto.safeParse({ requested_action: 'override', override_reason: 'same customer' })
        .success,
    ).toBe(true);
    expect(DuplicateCheckDto.parse(undefined)).toEqual({});
    expect(DuplicateCheckDto.parse({})).toEqual({});
  });

  it('rejects an unknown requested_action with the contract message', () => {
    const result = DuplicateCheckDto.safeParse({ requested_action: 'purge' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid action value.');
    }
  });
});
