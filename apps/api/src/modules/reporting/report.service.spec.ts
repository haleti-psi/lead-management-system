import { DataScope, ERROR_CODES, RoleCode, type ScopePredicate } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { AppConfigService } from '../../core/config';
import { isDomainException } from '../../core/http';
import type { MaskingService } from '../../core/masking';
import type { GetReportQueryDto } from './dto/get-report-query.dto';
import { pct } from './report.repository';
import type { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

/**
 * FR-120 unit tests for {@link ReportService}: scope enforcement (T-03, T-04,
 * T-05, T-06), zero-denominator rule (T-02), timeout (T-25 path), and
 * dispatch routing to the correct repo method.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const BRANCH_A = '00000000-0000-0000-0000-000000000011';
const BRANCH_B = '00000000-0000-0000-0000-000000000012';
const TEAM_A = '00000000-0000-0000-0000-000000000021';
const PARTNER_A = '00000000-0000-0000-0000-000000000031';
const RM_USER = '00000000-0000-0000-0000-000000000041';
const OTHER_USER = '00000000-0000-0000-0000-000000000042';
const SM_USER = '00000000-0000-0000-0000-000000000043';
const TEAM_MEMBER = '00000000-0000-0000-0000-000000000044';
const OUT_OF_TEAM_USER = '00000000-0000-0000-0000-000000000045';

function user(
  role: RoleCode,
  scope: DataScope,
  userId = RM_USER,
): AuthUser {
  return { userId, orgId: ORG, role, scope, jti: 'jti-1' };
}

const allScopePredicate: ScopePredicate = { type: 'all', orgId: ORG };
const ownScopePredicate: ScopePredicate = { type: 'own', userId: RM_USER };
const branchScopePredicate: ScopePredicate = { type: 'branch', branchId: BRANCH_A };
const teamScopePredicate: ScopePredicate = { type: 'team', userIds: [SM_USER, TEAM_MEMBER] };
const maskedScopePredicate: ScopePredicate = { type: 'masked', orgId: ORG };
const partnerScopePredicate: ScopePredicate = { type: 'partner', partnerId: PARTNER_A };

const BASE_QUERY: GetReportQueryDto = { page: 1, limit: 25 };

function baseRows() {
  return { rows: [], total: 0 };
}

function mockRepo(): jest.Mocked<ReportRepository> {
  return {
    funnel: jest.fn().mockResolvedValue(baseRows()),
    sourcePerformance: jest.fn().mockResolvedValue(baseRows()),
    rmPerformance: jest.fn().mockResolvedValue(baseRows()),
    rejectionSummary: jest.fn().mockResolvedValue(baseRows()),
  } as unknown as jest.Mocked<ReportRepository>;
}

function mockEntitlement(overrides?: {
  branchId?: string | null;
  teamId?: string | null;
  partnerId?: string | null;
  teamMemberIds?: string[];
  /** When set, a second loadActorEntitlement call for owner_id returns this branchId. */
  ownerBranchId?: string | null;
}): EntitlementCacheService {
  const actor = {
    userId: RM_USER,
    orgId: ORG,
    status: 'active',
    roleId: 'r1',
    roleCode: RoleCode.RM,
    defaultScope: DataScope.O,
    branchId: overrides?.branchId ?? null,
    teamId: overrides?.teamId ?? null,
    partnerId: overrides?.partnerId ?? null,
    regionId: null,
    permissions: new Map(),
  };
  // For BM owner_id checks: second loadActorEntitlement call returns the owner's
  // actor with the overrides.ownerBranchId. The first call returns the actor above.
  const ownerActor = overrides?.ownerBranchId !== undefined
    ? { ...actor, branchId: overrides.ownerBranchId }
    : null;
  const loadActorEntitlement = ownerActor != null
    ? jest.fn()
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce(ownerActor)
    : jest.fn().mockResolvedValue(actor);

  return {
    loadActorEntitlement,
    loadTeamMemberIds: jest.fn().mockResolvedValue(overrides?.teamMemberIds ?? []),
  } as unknown as EntitlementCacheService;
}

function mockConfig(timeoutMs = 8000): AppConfigService {
  return {
    get: jest.fn().mockReturnValue(timeoutMs),
  } as unknown as AppConfigService;
}

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as import('nestjs-pino').Logger;

function mockMasking(): MaskingService {
  return {
    mask: jest.fn().mockImplementation((_field: string, value: string | null) => {
      if (value == null) return null;
      // Simulate strict full_name masking: return first word only
      return value.trim().split(/\s+/)[0] ?? value;
    }),
  } as unknown as MaskingService;
}

function makeService(opts?: {
  repo?: jest.Mocked<ReportRepository>;
  entitlement?: EntitlementCacheService;
  timeoutMs?: number;
  masking?: MaskingService;
}): [ReportService, jest.Mocked<ReportRepository>] {
  const repo = opts?.repo ?? mockRepo();
  const entitlement = opts?.entitlement ?? mockEntitlement();
  const config = mockConfig(opts?.timeoutMs);
  const masking = opts?.masking ?? mockMasking();
  const svc = new ReportService(repo as unknown as ReportRepository, entitlement, config, logger, masking);
  return [svc, repo as jest.Mocked<ReportRepository>];
}

// ── Unit: pct helper (T-02) ──────────────────────────────────────────────────

describe('pct (zero-denominator rule)', () => {
  it('T-02: returns "–" when denominator is 0', () => {
    expect(pct(0, 0)).toBe('–');
    expect(pct(5, 0)).toBe('–');
  });

  it('returns formatted percentage when denominator > 0', () => {
    expect(pct(30, 100)).toBe('30.0');
    expect(pct(64, 210)).toBe('30.5');
  });
});

// ── resolveScope (scope validation) ────────────────────────────────────────

describe('ReportService.resolveScope', () => {
  // T-03: RM scope O — forced to own owner_id
  it('T-03: RM with no owner_id → predicate contains own userId', async () => {
    const [svc] = makeService({ entitlement: mockEntitlement() });
    const rm = user(RoleCode.RM, DataScope.O);
    const ctx = await svc.resolveScope(rm, BASE_QUERY, ownScopePredicate);
    expect(ctx.predicate.type).toBe('own');
  });

  // T-04: BM scope B
  it('T-04: BM → branch predicate attached', async () => {
    const [svc] = makeService({ entitlement: mockEntitlement({ branchId: BRANCH_A }) });
    const bm = user(RoleCode.BM, DataScope.B);
    const ctx = await svc.resolveScope(bm, BASE_QUERY, branchScopePredicate);
    expect(ctx.predicate.type).toBe('branch');
  });

  // T-05: RM passes wrong owner_id → FORBIDDEN
  it('T-05: RM sends owner_id of another user → FORBIDDEN', async () => {
    const [svc] = makeService();
    const rm = user(RoleCode.RM, DataScope.O, RM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, owner_id: OTHER_USER };
    await expect(svc.resolveScope(rm, query, ownScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  // T-06: PARTNER passes another partner's partner_id → FORBIDDEN
  it('T-06: PARTNER sends different partner_id → FORBIDDEN', async () => {
    const [svc] = makeService({
      entitlement: mockEntitlement({ partnerId: PARTNER_A }),
    });
    const partner = user(RoleCode.PARTNER, DataScope.P);
    const OTHER_PARTNER = '00000000-0000-0000-0000-000000000099';
    const query: GetReportQueryDto = { ...BASE_QUERY, partner_id: OTHER_PARTNER };
    await expect(svc.resolveScope(partner, query, partnerScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  it('BM passes a different branch_id → FORBIDDEN', async () => {
    const [svc] = makeService({ entitlement: mockEntitlement({ branchId: BRANCH_A }) });
    const bm = user(RoleCode.BM, DataScope.B);
    const query: GetReportQueryDto = { ...BASE_QUERY, branch_id: BRANCH_B };
    await expect(svc.resolveScope(bm, query, branchScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  it('RM passes own owner_id → allowed (not FORBIDDEN)', async () => {
    const [svc] = makeService();
    const rm = user(RoleCode.RM, DataScope.O, RM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, owner_id: RM_USER };
    const ctx = await svc.resolveScope(rm, query, ownScopePredicate);
    expect(ctx.filters.owner_id).toBe(RM_USER);
  });

  // RM scope-widening params → FORBIDDEN
  it('RM sends branch_id → FORBIDDEN (scope widening)', async () => {
    const [svc] = makeService();
    const rm = user(RoleCode.RM, DataScope.O, RM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, branch_id: BRANCH_A };
    await expect(svc.resolveScope(rm, query, ownScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  it('RM sends team_id → FORBIDDEN (scope widening)', async () => {
    const [svc] = makeService();
    const rm = user(RoleCode.RM, DataScope.O, RM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, team_id: TEAM_A };
    await expect(svc.resolveScope(rm, query, ownScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  // SM cross-team owner_id → FORBIDDEN
  it('SM with out-of-team owner_id → FORBIDDEN', async () => {
    const [svc] = makeService({
      entitlement: mockEntitlement({ teamId: TEAM_A, teamMemberIds: [SM_USER, TEAM_MEMBER] }),
    });
    const sm = user(RoleCode.SM, DataScope.T, SM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, owner_id: OUT_OF_TEAM_USER };
    await expect(svc.resolveScope(sm, query, teamScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  // SM with wrong team_id → FORBIDDEN
  it('SM sends a different team_id → FORBIDDEN', async () => {
    const OTHER_TEAM = '00000000-0000-0000-0000-000000000099';
    const [svc] = makeService({
      entitlement: mockEntitlement({ teamId: TEAM_A }),
    });
    const sm = user(RoleCode.SM, DataScope.T, SM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, team_id: OTHER_TEAM };
    await expect(svc.resolveScope(sm, query, teamScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  // SM with own team_id → allowed
  it('SM sends own team_id → allowed', async () => {
    const [svc] = makeService({
      entitlement: mockEntitlement({ teamId: TEAM_A }),
    });
    const sm = user(RoleCode.SM, DataScope.T, SM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, team_id: TEAM_A };
    const ctx = await svc.resolveScope(sm, query, teamScopePredicate);
    expect(ctx.filters.team_id).toBe(TEAM_A);
  });

  // BM with out-of-branch owner_id → FORBIDDEN
  it('BM with out-of-branch owner_id → FORBIDDEN', async () => {
    const [svc] = makeService({
      // First call returns BM's actor (branchId=BRANCH_A); second call returns
      // the candidate owner whose branch is BRANCH_B (out-of-scope).
      entitlement: mockEntitlement({ branchId: BRANCH_A, ownerBranchId: BRANCH_B }),
    });
    const bm = user(RoleCode.BM, DataScope.B);
    const query: GetReportQueryDto = { ...BASE_QUERY, owner_id: OTHER_USER };
    await expect(svc.resolveScope(bm, query, branchScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });

  // BM with out-of-branch branch_id → FORBIDDEN
  it('BM with out-of-branch branch_id → FORBIDDEN', async () => {
    const [svc] = makeService({ entitlement: mockEntitlement({ branchId: BRANCH_A }) });
    const bm = user(RoleCode.BM, DataScope.B);
    const query: GetReportQueryDto = { ...BASE_QUERY, branch_id: BRANCH_B };
    await expect(svc.resolveScope(bm, query, branchScopePredicate)).rejects.toSatisfyDomainException(
      ERROR_CODES.FORBIDDEN,
    );
  });
});

// ── getReport dispatch ────────────────────────────────────────────────────────

describe('ReportService.getReport dispatch', () => {
  const HEAD = user(RoleCode.HEAD, DataScope.A);

  it('T-01: funnel_conversion → calls repo.funnel', async () => {
    const [svc, repo] = makeService();
    repo.funnel.mockResolvedValue({ rows: [], total: 0 });
    await svc.getReport('funnel_conversion', BASE_QUERY, HEAD, allScopePredicate);
    expect(repo.funnel).toHaveBeenCalledTimes(1);
  });

  it('T-09: source_performance → calls repo.sourcePerformance', async () => {
    const [svc, repo] = makeService();
    await svc.getReport('source_performance', BASE_QUERY, HEAD, allScopePredicate);
    expect(repo.sourcePerformance).toHaveBeenCalledTimes(1);
  });

  it('rm_performance → calls repo.rmPerformance', async () => {
    const [svc, repo] = makeService();
    await svc.getReport('rm_performance', BASE_QUERY, HEAD, allScopePredicate);
    expect(repo.rmPerformance).toHaveBeenCalledTimes(1);
  });

  it('T-10: rejection_summary → calls repo.rejectionSummary', async () => {
    const [svc, repo] = makeService();
    await svc.getReport('rejection_summary', BASE_QUERY, HEAD, allScopePredicate);
    expect(repo.rejectionSummary).toHaveBeenCalledTimes(1);
  });

  it('funnel result contains generated_at, scope, period', async () => {
    const [svc] = makeService();
    const { data } = await svc.getReport('funnel_conversion', BASE_QUERY, HEAD, allScopePredicate);
    expect(data.report_code).toBe('funnel_conversion');
    expect(data.generated_at).toMatch(/\+05:30$/);
    expect(data.scope).toEqual({ branch_id: null, team_id: null, owner_id: null });
    expect(data.period).toEqual({ from: null, to: null });
  });

  // T-25: query timeout → INTERNAL_ERROR
  it('T-25: service wraps timeout into INTERNAL_ERROR', async () => {
    // Intercept setTimeout so we can control which promise wins the race.
    // We install a replacement that fires immediately (0-tick) so the
    // "timeout" always beats the repo promise that hangs forever.
    const origSetTimeout = global.setTimeout;
    const fakeSetTimeout = jest.fn().mockImplementation((fn: () => void) => {
      // Schedule immediately so it fires before the hanging repo resolves
      return origSetTimeout(fn, 0);
    });
    global.setTimeout = fakeSetTimeout as unknown as typeof setTimeout;

    const repo2 = mockRepo();
    // Repo that never resolves (hangs indefinitely)
    repo2.funnel.mockReturnValue(new Promise<{ rows: never[]; total: number }>(() => { /* never */ }));

    const [svc] = makeService({ repo: repo2, timeoutMs: 8000 });

    try {
      await expect(
        svc.getReport('funnel_conversion', BASE_QUERY, HEAD, allScopePredicate),
      ).rejects.toSatisfyDomainException(ERROR_CODES.INTERNAL_ERROR);
    } finally {
      global.setTimeout = origSetTimeout;
    }
  }, 10000);
});

// ── DPO masking (MAJOR 5) ────────────────────────────────────────────────────

describe('ReportService DPO masking — rm_performance owner_name', () => {
  it('masks owner_name for masked predicate (DPO)', async () => {
    const repo = mockRepo();
    repo.rmPerformance.mockResolvedValue({
      rows: [
        {
          owner_id: RM_USER,
          owner_name: 'Ravi Kumar',
          captured: 10,
          contacted: 8,
          qualified: 5,
          handed_off: 3,
          rejected: 2,
          rejection_rate_pct: '20.0',
        },
      ],
      total: 1,
    });
    const masking = mockMasking();
    const [svc] = makeService({ repo, masking });
    const HEAD = user(RoleCode.HEAD, DataScope.M);
    const { data } = await svc.getReport('rm_performance', BASE_QUERY, HEAD, maskedScopePredicate);
    // MaskingService.mask must have been called for owner_name
    expect(masking.mask).toHaveBeenCalledWith('full_name', 'Ravi Kumar', { strict: true });
    // The returned row must contain the masked value
    const row = data.rows[0] as { owner_name: string };
    // Our mock masking returns first word: 'Ravi'
    expect(row.owner_name).toBe('Ravi');
  });

  it('does NOT mask owner_name for non-masked predicate (HEAD all-scope)', async () => {
    const repo = mockRepo();
    repo.rmPerformance.mockResolvedValue({
      rows: [
        {
          owner_id: RM_USER,
          owner_name: 'Ravi Kumar',
          captured: 10,
          contacted: 8,
          qualified: 5,
          handed_off: 3,
          rejected: 2,
          rejection_rate_pct: '20.0',
        },
      ],
      total: 1,
    });
    const masking = mockMasking();
    const [svc] = makeService({ repo, masking });
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const { data } = await svc.getReport('rm_performance', BASE_QUERY, HEAD, allScopePredicate);
    expect(masking.mask).not.toHaveBeenCalled();
    const row = data.rows[0] as { owner_name: string };
    expect(row.owner_name).toBe('Ravi Kumar');
  });
});

// ── Source filter pass-through (MAJOR 4) ────────────────────────────────────

describe('ReportService source filter pass-through', () => {
  it('source param propagated to filters for funnel_conversion', async () => {
    const [svc, repo] = makeService();
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const query: GetReportQueryDto = { ...BASE_QUERY, source: 'branch_walk_in' as import('@lms/shared').LeadSource };
    await svc.getReport('funnel_conversion', query, HEAD, allScopePredicate);
    const call = repo.funnel.mock.calls[0];
    expect(call?.[2].source).toBe('branch_walk_in');
  });

  it('source param propagated to filters for source_performance', async () => {
    const [svc, repo] = makeService();
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const query: GetReportQueryDto = { ...BASE_QUERY, source: 'branch_walk_in' as import('@lms/shared').LeadSource };
    await svc.getReport('source_performance', query, HEAD, allScopePredicate);
    const call = repo.sourcePerformance.mock.calls[0];
    expect(call?.[2].source).toBe('branch_walk_in');
  });
});

// ── Date range and period ────────────────────────────────────────────────────

describe('ReportService period handling', () => {
  it('T-08 (service layer): from/to propagated to filters', async () => {
    const [svc, repo] = makeService();
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-05-31T00:00:00.000Z');
    const query: GetReportQueryDto = { ...BASE_QUERY, from, to };
    await svc.getReport('funnel_conversion', query, HEAD, allScopePredicate);
    const call = repo.funnel.mock.calls[0];
    expect(call?.[2].from).toEqual(from);
    expect(call?.[2].to).toEqual(to);
  });
});

// ── Custom Jest matcher helper ─────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toSatisfyDomainException(code: string): R;
    }
  }
}

expect.extend({
  toSatisfyDomainException(received: unknown, code: string) {
    const pass = isDomainException(received) && received.code === code;
    return {
      pass,
      message: () =>
        pass
          ? `Expected error not to be DomainException(${code})`
          : `Expected DomainException(${code}) but got: ${String(received)}`,
    };
  },
});
