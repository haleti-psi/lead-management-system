import { ERROR_CODES } from '@lms/shared';

import { MaskingService } from '../../core/masking';
import { DomainException } from '../../core/http';
import type { AuthUser } from '../../core/auth';
import type { GetDashboardQueryDto } from './dto/get-dashboard-query.dto';
import type {
  HandoffFailureEntry,
  HotLeadRow,
  KpiWidget,
  SlaAlertRow,
  SourceSummaryRow,
  TaskRow,
} from './dto/dashboard-payload.dto';
import { DashboardService } from './dashboard.service';
import type { DashboardRepository } from './dashboard.repository';
import type { EntitlementCacheService } from '../../core/auth/entitlement-cache.service';

/**
 * FR-053 — unit tests for DashboardService (scope resolution + widget assembly).
 *
 * Covers the spec's required unit test groups:
 *   - resolveScope: O/B/T/A scope resolution + override validation
 *   - getWidgets: allSettled degradation + cache hit/miss + Redis fallback
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const BRANCH_A = 'branch-aaaa-0000-0000-000000000001';
const BRANCH_B = 'branch-bbbb-0000-0000-000000000002';
const TEAM_1 = 'team-1111-0000-0000-000000000001';

function makeUser(
  role: AuthUser['role'],
  scope: AuthUser['scope'],
  userId = 'user-1',
): AuthUser {
  return { userId, orgId: ORG, role, scope, jti: 'j1' };
}

function makeEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    orgId: ORG,
    status: 'active',
    roleCode: 'RM',
    branchId: BRANCH_A,
    teamId: TEAM_1,
    regionId: null,
    partnerId: null,
    defaultScope: 'O',
    permissions: new Map(),
    ...overrides,
  };
}

const kpiFixture: KpiWidget = {
  active_pipeline: 5,
  captured_today: 2,
  hot_leads: 1,
  sla_breached: 0,
  consent_coverage_pct: 100,
  handed_off_this_month: 1,
};

const slaFixture: SlaAlertRow[] = [];
const hotRawFixture = [
  {
    lead_id: 'l-1',
    lead_code: 'LD-2026-000001',
    stage: 'first_contact_pending',
    score: 88,
    name: 'Ramesh Kumar',
    mobile: '9812345610',
    owner_name: 'Rahul',
  },
];
const tasksFixture: TaskRow[] = [];
const sourceFixture: SourceSummaryRow[] = [];
const handoffFixture: HandoffFailureEntry[] = [];

interface Harness {
  service: DashboardService;
  repo: Record<string, jest.Mock>;
  entitlementCache: Record<string, jest.Mock>;
  redis: { get: jest.Mock; set: jest.Mock };
  logger: Record<string, jest.Mock>;
}

function makeHarness(
  repoOverrides: Partial<Record<string, jest.Mock>> = {},
  entitlementOverrides: Record<string, unknown> = {},
): Harness {
  const repo: Record<string, jest.Mock> = {
    getKpi: jest.fn().mockResolvedValue(kpiFixture),
    getSlaAlerts: jest.fn().mockResolvedValue(slaFixture),
    getHotLeads: jest.fn().mockResolvedValue(hotRawFixture),
    getMyTasks: jest.fn().mockResolvedValue(tasksFixture),
    getSourceSummary: jest.fn().mockResolvedValue(sourceFixture),
    getHandoffFailures: jest.fn().mockResolvedValue(handoffFixture),
    ...repoOverrides,
  };

  const entitlementCache = {
    loadActorEntitlement: jest
      .fn()
      .mockResolvedValue(makeEntitlement(entitlementOverrides)),
    loadTeamMemberIds: jest.fn().mockResolvedValue(['member-1', 'member-2']),
  };

  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };

  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };

  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'DASHBOARD_CACHE_TTL_SECONDS') return 60;
      return undefined;
    }),
  };

  const service = new DashboardService(
    repo as unknown as DashboardRepository,
    entitlementCache as unknown as EntitlementCacheService,
    new MaskingService(),
    config as unknown as ConstructorParameters<typeof DashboardService>[3],
    redis as unknown as ConstructorParameters<typeof DashboardService>[4],
    logger as unknown as ConstructorParameters<typeof DashboardService>[5],
  );

  return { service, repo, entitlementCache, redis, logger };
}

const emptyQuery: GetDashboardQueryDto = {};

// ── resolveScope tests ────────────────────────────────────────────────────────

describe('DashboardService.resolveScope', () => {
  it('resolves O scope for RM role', async () => {
    const { service } = makeHarness({}, { roleCode: 'RM', branchId: null, teamId: null });
    const ctx = await service.resolveScope(makeUser('RM', 'O'), emptyQuery);
    expect(ctx.role).toBe('RM');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.branchIds).toEqual([]);
    expect(ctx.teamMemberIds).toEqual([]);
  });

  it('resolves B scope for BM role from user branchId', async () => {
    const { service } = makeHarness({}, { roleCode: 'BM', branchId: BRANCH_A });
    const ctx = await service.resolveScope(makeUser('BM', 'B'), emptyQuery);
    expect(ctx.role).toBe('BM');
    expect(ctx.branchIds).toEqual([BRANCH_A]);
    expect(ctx.teamMemberIds).toEqual([]);
  });

  it('resolves T scope for SM role from entitlement teamId', async () => {
    const { service, entitlementCache } = makeHarness(
      {},
      { roleCode: 'SM', teamId: TEAM_1, branchId: null },
    );
    const ctx = await service.resolveScope(makeUser('SM', 'T'), emptyQuery);
    expect(ctx.role).toBe('SM');
    expect(entitlementCache.loadTeamMemberIds).toHaveBeenCalledWith(TEAM_1, ORG);
    expect(ctx.teamMemberIds).toEqual(['member-1', 'member-2']);
  });

  it('resolves A scope for HEAD role (org-wide)', async () => {
    const { service } = makeHarness({}, { roleCode: 'HEAD', branchId: null, teamId: null });
    const ctx = await service.resolveScope(makeUser('HEAD', 'A'), emptyQuery);
    expect(ctx.role).toBe('HEAD');
    expect(ctx.branchIds).toEqual([]);
    expect(ctx.teamMemberIds).toEqual([]);
  });

  it('throws FORBIDDEN when branch_id override is outside BM scope', async () => {
    const { service } = makeHarness({}, { roleCode: 'BM', branchId: BRANCH_A });
    await expect(
      service.resolveScope(makeUser('BM', 'B'), { branch_id: BRANCH_B }),
    ).rejects.toThrow(
      expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
    );
  });

  it('throws FORBIDDEN (403) when SM supplies a foreign team_id (cross-team leak prevention)', async () => {
    const FOREIGN_TEAM = 'team-9999-0000-0000-000000000099';
    const { service } = makeHarness({}, { roleCode: 'SM', teamId: TEAM_1, branchId: null });
    await expect(
      service.resolveScope(makeUser('SM', 'T'), { team_id: FOREIGN_TEAM }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN, httpStatus: 403 });
  });

  it('TC-03: throws FORBIDDEN (403) when PARTNER role attempts dashboard access', async () => {
    const { service } = makeHarness({}, { roleCode: 'PARTNER' });
    await expect(
      service.resolveScope(makeUser('PARTNER' as AuthUser['role'], 'P'), emptyQuery),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN, httpStatus: 403 });
  });
});

// ── getWidgets — full payload ─────────────────────────────────────────────────

describe('DashboardService.getWidgets', () => {
  it('returns full widget payload when all queries succeed', async () => {
    const { service } = makeHarness({}, { roleCode: 'BM', branchId: BRANCH_A });
    const result = await service.getWidgets(makeUser('BM', 'B'), emptyQuery);

    expect(result.widgets.widget_errors).toHaveLength(0);
    expect(result.widgets.kpi).toMatchObject({ active_pipeline: 5 });
    expect(result.cache_hit).toBe(false);
    expect(result.role).toBe('BM');
  });

  it('populates widget_errors when getHandoffFailures rejects; other widgets unaffected', async () => {
    const { service } = makeHarness(
      { getHandoffFailures: jest.fn().mockRejectedValue(new Error('DB error')) },
      { roleCode: 'BM', branchId: BRANCH_A },
    );
    const result = await service.getWidgets(makeUser('BM', 'B'), emptyQuery);

    expect(result.widgets.handoff_failures).toBeNull();
    expect(result.widgets.widget_errors).toHaveLength(1);
    expect(result.widgets.widget_errors[0]).toMatchObject({
      widget: 'handoff_failures',
      error_code: 'INTERNAL_ERROR',
    });
    // Other widgets intact
    expect(result.widgets.kpi).not.toBeNull();
    expect(result.widgets.hot_leads).not.toBeNull();
  });

  it('populates widget_errors for multiple failed widgets; response still 200-shaped', async () => {
    const { service } = makeHarness(
      {
        getHandoffFailures: jest.fn().mockRejectedValue(new Error('fail')),
        getSourceSummary: jest.fn().mockRejectedValue(new Error('fail')),
      },
      { roleCode: 'BM', branchId: BRANCH_A },
    );
    const result = await service.getWidgets(makeUser('BM', 'B'), emptyQuery);

    expect(result.widgets.widget_errors).toHaveLength(2);
    expect(result.widgets.handoff_failures).toBeNull();
    expect(result.widgets.source_summary).toBeNull();
    expect(result.widgets.kpi).not.toBeNull();
  });

  it('returns cache_hit=true on second call within TTL (Redis mock returns cached value)', async () => {
    const { service, redis } = makeHarness({}, { roleCode: 'BM', branchId: BRANCH_A });
    // First call: no cache
    const first = await service.getWidgets(makeUser('BM', 'B'), emptyQuery);
    expect(first.cache_hit).toBe(false);

    // Simulate Redis returning cached payload
    redis.get.mockResolvedValue(JSON.stringify({ ...first, cache_hit: false }));

    const second = await service.getWidgets(makeUser('BM', 'B'), emptyQuery);
    expect(second.cache_hit).toBe(true);
  });

  it('falls back to DB when RedisService.get throws; logs warn', async () => {
    const { service, logger } = makeHarness({}, { roleCode: 'BM', branchId: BRANCH_A });
    // Patch the redis mock to throw on GET
    const harness = makeHarness({}, { roleCode: 'BM', branchId: BRANCH_A });
    harness.redis.get.mockRejectedValue(new Error('Redis unavailable'));

    const result = await harness.service.getWidgets(makeUser('BM', 'B'), emptyQuery);

    expect(result.cache_hit).toBe(false);
    expect(result.widgets.kpi).not.toBeNull();
    expect(harness.logger.warn).toHaveBeenCalled();
    void service; // suppress unused variable warning
    void logger;
  });

  it('masks name and mobile in hot_leads for partial scope', async () => {
    const { service } = makeHarness({}, { roleCode: 'BM', branchId: BRANCH_A });
    const result = await service.getWidgets(makeUser('BM', 'B'), emptyQuery);

    expect(result.widgets.hot_leads).not.toBeNull();
    const hl = result.widgets.hot_leads as HotLeadRow[];
    expect(hl[0].name_masked).toBe('Ramesh Kumar'); // partial: full_name not strict
    expect(hl[0].mobile_masked).toBe('98xxxxxx10'); // mobile always masked
    expect((hl[0] as unknown as Record<string, unknown>)['name']).toBeUndefined();
    expect((hl[0] as unknown as Record<string, unknown>)['mobile']).toBeUndefined();
  });

  it('applies strict masking for DPO scope', async () => {
    const { service } = makeHarness({}, { roleCode: 'DPO', branchId: null, teamId: null });
    const result = await service.getWidgets(makeUser('DPO', 'M'), emptyQuery);

    const hl = result.widgets.hot_leads as HotLeadRow[];
    // DPO strict: name → first name only
    expect(hl[0].name_masked).toBe('Ramesh');
  });

  it('resolves HEAD scope and includes branch_id in response when override supplied', async () => {
    const { service } = makeHarness({}, { roleCode: 'HEAD', branchId: null, teamId: null });
    const result = await service.getWidgets(makeUser('HEAD', 'A'), { branch_id: BRANCH_A });
    expect(result.scope).toMatchObject({ branch_id: BRANCH_A });
  });
});

// ── resolveScope — entitlement not found ─────────────────────────────────────

describe('DashboardService — AUTH_REQUIRED when entitlement missing', () => {
  it('throws AUTH_REQUIRED when actor entitlement not found', async () => {
    const harness = makeHarness();
    harness.entitlementCache.loadActorEntitlement.mockResolvedValue(undefined);

    await expect(
      harness.service.resolveScope(makeUser('RM', 'O'), emptyQuery),
    ).rejects.toMatchObject({ code: ERROR_CODES.AUTH_REQUIRED });
  });
});

// ── DTO validation (schema unit tests) ───────────────────────────────────────

describe('GetDashboardQuerySchema', () => {
  it('parses empty query', async () => {
    const { GetDashboardQuerySchema } = await import('./dto/get-dashboard-query.dto');
    expect(() => GetDashboardQuerySchema.parse({})).not.toThrow();
  });

  it('rejects as_of in the future', async () => {
    const { GetDashboardQuerySchema } = await import('./dto/get-dashboard-query.dto');
    const result = GetDashboardQuerySchema.safeParse({ as_of: '2099-01-01T00:00:00Z' });
    expect(result.success).toBe(false);
  });

  it('rejects both branch_id and team_id', async () => {
    const { GetDashboardQuerySchema } = await import('./dto/get-dashboard-query.dto');
    const result = GetDashboardQuerySchema.safeParse({
      branch_id: BRANCH_A,
      team_id: TEAM_1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID for branch_id', async () => {
    const { GetDashboardQuerySchema } = await import('./dto/get-dashboard-query.dto');
    const result = GetDashboardQuerySchema.safeParse({ branch_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

// ── DashboardRepository — applyScopeToLeads compile-level tests ──────────────

describe('applyScopeToLeads (scope predicate helper)', () => {
  it('is importable and exports applyScopeToLeads', async () => {
    const mod = await import('./dashboard.repository');
    expect(typeof mod.applyScopeToLeads).toBe('function');
  });

  it('adds WHERE owner_id = userId for RM scope (via mock qb)', () => {
    const { applyScopeToLeads } = require('./dashboard.repository');
    const whereCalls: Array<[string, string, string]> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb: any = { where: jest.fn((...args: [string, string, string]) => { whereCalls.push(args); return qb; }) };
    const ctx = {
      role: 'RM',
      userId: 'rm-1',
      orgId: ORG,
      branchIds: [],
      teamMemberIds: [],
      asOf: new Date(),
    };
    applyScopeToLeads(qb, ctx);
    expect(qb.where).toHaveBeenCalledWith('leads.owner_id', '=', 'rm-1');
  });

  it('adds WHERE team_id IN teamIds for SM scope', () => {
    const { applyScopeToLeads } = require('./dashboard.repository');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb: any = { where: jest.fn(() => qb) };
    const ctx = {
      role: 'SM',
      userId: 'sm-1',
      orgId: ORG,
      branchIds: [],
      teamMemberIds: ['m1', 'm2'],
      asOf: new Date(),
    };
    applyScopeToLeads(qb, ctx);
    expect(qb.where).toHaveBeenCalledWith('leads.owner_id', 'in', ['m1', 'm2']);
  });

  it('adds WHERE branch_id IN branchIds for BM scope', () => {
    const { applyScopeToLeads } = require('./dashboard.repository');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb: any = { where: jest.fn(() => qb) };
    const ctx = {
      role: 'BM',
      userId: 'bm-1',
      orgId: ORG,
      branchIds: [BRANCH_A],
      teamMemberIds: [],
      asOf: new Date(),
    };
    applyScopeToLeads(qb, ctx);
    expect(qb.where).toHaveBeenCalledWith('leads.branch_id', 'in', [BRANCH_A]);
  });

  it('adds no predicate for HEAD scope (org-wide)', () => {
    const { applyScopeToLeads } = require('./dashboard.repository');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb: any = { where: jest.fn(() => qb) };
    const ctx = {
      role: 'HEAD',
      userId: 'head-1',
      orgId: ORG,
      branchIds: [],
      teamMemberIds: [],
      asOf: new Date(),
    };
    const result = applyScopeToLeads(qb, ctx);
    expect(qb.where).not.toHaveBeenCalled();
    expect(result).toBe(qb);
  });

  it('returns false predicate for SM with empty teamMemberIds', () => {
    const { applyScopeToLeads } = require('./dashboard.repository');
    const whereCalls: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb: any = { where: jest.fn((...args: unknown[]) => { whereCalls.push(args); return qb; }) };
    const ctx = {
      role: 'SM',
      userId: 'sm-1',
      orgId: ORG,
      branchIds: [],
      teamMemberIds: [],
      asOf: new Date(),
    };
    applyScopeToLeads(qb, ctx);
    // Called with sql`false` sentinel
    expect(qb.where).toHaveBeenCalledTimes(1);
  });
});

// ── DomainException is exported correctly ─────────────────────────────────────

describe('DomainException (smoke)', () => {
  it('constructs FORBIDDEN code', () => {
    const ex = new DomainException(ERROR_CODES.FORBIDDEN);
    expect(ex.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(ex.httpStatus).toBe(403);
  });
});
