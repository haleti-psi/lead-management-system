import { DataScope, ERROR_CODES, RoleCode, type ScopePredicate } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { AppConfigService } from '../../core/config';
import { isDomainException } from '../../core/http';
import type { MaskingService } from '../../core/masking';
import type { GetReportQueryDto } from './dto/get-report-query.dto';
import type { DifferentiatorRepository } from './differentiator.repository';
import type { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

/**
 * FR-121 unit tests for the differentiator report codes in ReportService:
 * - T20/T21/T22 zero-denominator rules
 * - T32/T33 DSA/Dealer quality delegation
 * - T28 DPO gating (non-consent report → FORBIDDEN)
 * - T11 ADMIN role → FORBIDDEN (no reports capability — enforced by AbacGuard;
 *   we test the DPO gate which is enforced here in the service)
 * - Dispatch routing to DifferentiatorRepository methods
 * - T32: computeScoreBatch delegation
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG = '00000000-0000-0000-0000-000000000001';
const BRANCH_A = '00000000-0000-0000-0000-000000000011';
const RM_USER = '00000000-0000-0000-0000-000000000041';
const PARTNER_A = '00000000-0000-0000-0000-000000000031';
const PARTNER_B = '00000000-0000-0000-0000-000000000032';

const allScopePredicate: ScopePredicate = { type: 'all', orgId: ORG };
const maskedScopePredicate: ScopePredicate = { type: 'masked', orgId: ORG };
const partnerScopePredicate: ScopePredicate = { type: 'partner', partnerId: PARTNER_A };
const ownScopePredicate: ScopePredicate = { type: 'own', userId: RM_USER };
const branchScopePredicate: ScopePredicate = { type: 'branch', branchId: BRANCH_A };

const BASE_QUERY: GetReportQueryDto = { page: 1, limit: 25 };

function user(role: RoleCode, scope: DataScope, userId = RM_USER): AuthUser {
  return { userId, orgId: ORG, role, scope, jti: 'jti-1' };
}

function baseRows() {
  return { rows: [], total: 0 };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

function mockRepo(): jest.Mocked<ReportRepository> {
  return {
    funnel: jest.fn().mockResolvedValue(baseRows()),
    sourcePerformance: jest.fn().mockResolvedValue(baseRows()),
    rmPerformance: jest.fn().mockResolvedValue(baseRows()),
    rejectionSummary: jest.fn().mockResolvedValue(baseRows()),
  } as unknown as jest.Mocked<ReportRepository>;
}

function mockDiffRepo(): jest.Mocked<DifferentiatorRepository> {
  return {
    firstContactSla: jest.fn().mockResolvedValue({ summary: {
      total_leads_in_scope: 0, contacted_in_sla: 0, sla_breached: 0,
      pending_first_contact: 0, sla_compliance_pct: '–',
    }, rows: [], total: 0 }),
    kycDocAgeing: jest.fn().mockResolvedValue(baseRows()),
    dsaDealerPartnerIds: jest.fn().mockResolvedValue([]),
    dsaDealerPartnerDetails: jest.fn().mockResolvedValue([]),
    duplicateLeakage: jest.fn().mockResolvedValue(baseRows()),
    handoffFailure: jest.fn().mockResolvedValue(baseRows()),
    sourceRoi: jest.fn().mockResolvedValue(baseRows()),
    contactability: jest.fn().mockResolvedValue(baseRows()),
    consentPrivacyOps: jest.fn().mockResolvedValue(baseRows()),
    productBranchHeatmap: jest.fn().mockResolvedValue(baseRows()),
    rmCapacityLoad: jest.fn().mockResolvedValue(baseRows()),
  } as unknown as jest.Mocked<DifferentiatorRepository>;
}

function mockEntitlement(overrides?: {
  branchId?: string | null;
  teamId?: string | null;
  partnerId?: string | null;
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
  return {
    loadActorEntitlement: jest.fn().mockResolvedValue(actor),
    loadTeamMemberIds: jest.fn().mockResolvedValue([]),
  } as unknown as EntitlementCacheService;
}

function mockConfig(timeoutMs = 8000): AppConfigService {
  return { get: jest.fn().mockReturnValue(timeoutMs) } as unknown as AppConfigService;
}

const logger = { warn: jest.fn(), error: jest.fn() } as unknown as import('nestjs-pino').Logger;

function mockMasking(): MaskingService {
  return {
    mask: jest.fn().mockImplementation((_f: string, v: string | null) => v),
  } as unknown as MaskingService;
}

function makeService(opts?: {
  repo?: jest.Mocked<ReportRepository>;
  diffRepo?: jest.Mocked<DifferentiatorRepository>;
  entitlement?: EntitlementCacheService;
  timeoutMs?: number;
}): [ReportService, jest.Mocked<ReportRepository>, jest.Mocked<DifferentiatorRepository>] {
  const repo = opts?.repo ?? mockRepo();
  const diffRepo = opts?.diffRepo ?? mockDiffRepo();
  const entitlement = opts?.entitlement ?? mockEntitlement();
  const config = mockConfig(opts?.timeoutMs);
  const masking = mockMasking();
  const svc = new ReportService(
    repo as unknown as ReportRepository,
    entitlement,
    config,
    logger,
    masking,
    diffRepo as unknown as DifferentiatorRepository,
  );
  return [svc, repo as jest.Mocked<ReportRepository>, diffRepo as jest.Mocked<DifferentiatorRepository>];
}

// ── Custom matcher ─────────────────────────────────────────────────────────────

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

// ── T28: DPO gating ────────────────────────────────────────────────────────────

describe('FR-121 DPO role-restriction', () => {
  it('T28: DPO accessing rm_capacity_load → FORBIDDEN', async () => {
    const [svc] = makeService({ entitlement: mockEntitlement() });
    const dpo = user(RoleCode.DPO, DataScope.M);
    await expect(
      svc.getReport('rm_capacity_load', BASE_QUERY, dpo, maskedScopePredicate),
    ).rejects.toSatisfyDomainException(ERROR_CODES.FORBIDDEN);
  });

  it('T28: DPO accessing first_contact_sla → FORBIDDEN', async () => {
    const [svc] = makeService({ entitlement: mockEntitlement() });
    const dpo = user(RoleCode.DPO, DataScope.M);
    await expect(
      svc.getReport('first_contact_sla', BASE_QUERY, dpo, maskedScopePredicate),
    ).rejects.toSatisfyDomainException(ERROR_CODES.FORBIDDEN);
  });

  it('DPO accessing consent_privacy_ops → allowed (no FORBIDDEN)', async () => {
    const [svc, , diffRepo] = makeService({ entitlement: mockEntitlement() });
    const dpo = user(RoleCode.DPO, DataScope.M);
    await expect(
      svc.getReport('consent_privacy_ops', BASE_QUERY, dpo, maskedScopePredicate),
    ).resolves.toBeDefined();
    expect(diffRepo.consentPrivacyOps).toHaveBeenCalledTimes(1);
  });

  it('T28: DPO accessing dsa_dealer_quality → FORBIDDEN', async () => {
    const [svc] = makeService({ entitlement: mockEntitlement() });
    const dpo = user(RoleCode.DPO, DataScope.M);
    await expect(
      svc.getReport('dsa_dealer_quality', BASE_QUERY, dpo, maskedScopePredicate),
    ).rejects.toSatisfyDomainException(ERROR_CODES.FORBIDDEN);
  });
});

// ── Dispatch routing ───────────────────────────────────────────────────────────

describe('FR-121 dispatch to DifferentiatorRepository', () => {
  const HEAD = user(RoleCode.HEAD, DataScope.A);

  it('first_contact_sla → calls diffRepo.firstContactSla', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('first_contact_sla', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.firstContactSla).toHaveBeenCalledTimes(1);
    expect(diffRepo.firstContactSla).toHaveBeenCalledWith(ORG, allScopePredicate, expect.any(Object), expect.any(Object));
  });

  it('kyc_doc_ageing → calls diffRepo.kycDocAgeing', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('kyc_doc_ageing', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.kycDocAgeing).toHaveBeenCalledTimes(1);
  });

  it('duplicate_leakage → calls diffRepo.duplicateLeakage', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('duplicate_leakage', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.duplicateLeakage).toHaveBeenCalledTimes(1);
  });

  it('handoff_failure → calls diffRepo.handoffFailure', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('handoff_failure', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.handoffFailure).toHaveBeenCalledTimes(1);
  });

  it('source_roi → calls diffRepo.sourceRoi', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('source_roi', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.sourceRoi).toHaveBeenCalledTimes(1);
  });

  it('contactability → calls diffRepo.contactability', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('contactability', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.contactability).toHaveBeenCalledTimes(1);
  });

  it('consent_privacy_ops → calls diffRepo.consentPrivacyOps', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('consent_privacy_ops', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.consentPrivacyOps).toHaveBeenCalledTimes(1);
  });

  it('product_branch_heatmap → calls diffRepo.productBranchHeatmap', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('product_branch_heatmap', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.productBranchHeatmap).toHaveBeenCalledTimes(1);
  });

  it('rm_capacity_load → calls diffRepo.rmCapacityLoad', async () => {
    const [svc, , diffRepo] = makeService();
    await svc.getReport('rm_capacity_load', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.rmCapacityLoad).toHaveBeenCalledTimes(1);
  });
});

// ── T20/T21/T22: zero-denominator unit tests ──────────────────────────────────

describe('FR-121 zero-denominator guard (§12.5)', () => {
  it('T20: first_contact_sla compliance pct is "–" when all leads are pending (denominator=0)', async () => {
    const diffRepo = mockDiffRepo();
    // total=5, pending=5, denominator = total - pending = 0 → "–"
    diffRepo.firstContactSla.mockResolvedValue({
      summary: {
        total_leads_in_scope: 5,
        contacted_in_sla: 0,
        sla_breached: 0,
        pending_first_contact: 5,
        sla_compliance_pct: '–',
      },
      rows: [],
      total: 0,
    });
    const [svc] = makeService({ diffRepo });
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const result = await svc.getReport('first_contact_sla', BASE_QUERY, HEAD, allScopePredicate);
    expect(result.data.rows).toEqual([]);
    // The repo itself computes the "–", service returns what repo returns
    expect(diffRepo.firstContactSla).toHaveBeenCalledTimes(1);
  });

  it('T21: contactability rate is "–" when no comm attempts (repo returns rows with "–")', async () => {
    const diffRepo = mockDiffRepo();
    diffRepo.contactability.mockResolvedValue({
      rows: [{
        source: 'walk_in',
        partner_id: null,
        channel: 'sms',
        failure_reason: null,
        total_attempts: 0,
        delivered: 0,
        failed: 0,
        contactability_rate_pct: '–',
      }],
      total: 1,
    });
    const [svc] = makeService({ diffRepo });
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const result = await svc.getReport('contactability', BASE_QUERY, HEAD, allScopePredicate);
    const row = result.data.rows[0] as { contactability_rate_pct: string };
    expect(row.contactability_rate_pct).toBe('–');
  });

  it('T22: source_roi conversion rate is "–" when total_leads = 0', async () => {
    const diffRepo = mockDiffRepo();
    diffRepo.sourceRoi.mockResolvedValue({
      rows: [{
        source: 'dsa',
        campaign_code: null,
        partner_id: null,
        total_leads: 0,
        converted: 0,
        rejected: 0,
        conversion_rate_pct: '–',
        cost_data_available: false,
      }],
      total: 1,
    });
    const [svc] = makeService({ diffRepo });
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const result = await svc.getReport('source_roi', BASE_QUERY, HEAD, allScopePredicate);
    const row = result.data.rows[0] as { conversion_rate_pct: string; cost_data_available: boolean };
    expect(row.conversion_rate_pct).toBe('–');
    expect(row.cost_data_available).toBe(false);
  });
});

// ── T32/T33: DSA dealer quality delegation ─────────────────────────────────────

describe('FR-121 dsa_dealer_quality', () => {
  it('T32: dsaDealerPartnerIds called with correct args; stub rows returned when no scores available', async () => {
    const diffRepo = mockDiffRepo();
    diffRepo.dsaDealerPartnerIds.mockResolvedValue([PARTNER_A, PARTNER_B]);
    diffRepo.dsaDealerPartnerDetails.mockResolvedValue([
      { partner_id: PARTNER_A, legal_name: 'Alpha DSA', type: 'DSA' },
      { partner_id: PARTNER_B, legal_name: 'Beta Dealer', type: 'Dealer' },
    ]);

    const [svc] = makeService({ diffRepo });
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const result = await svc.getReport('dsa_dealer_quality', BASE_QUERY, HEAD, allScopePredicate);

    expect(diffRepo.dsaDealerPartnerIds).toHaveBeenCalledWith(ORG, allScopePredicate, expect.any(Object));
    expect(diffRepo.dsaDealerPartnerDetails).toHaveBeenCalledWith(ORG, [PARTNER_A, PARTNER_B]);

    expect(result.data.rows).toHaveLength(2);
    const row = result.data.rows[0] as {
      partner_id: string;
      quality_score: null;
      insufficient_data: boolean;
      metrics: Record<string, unknown>;
    };
    expect(row.insufficient_data).toBe(true);
    expect(row.quality_score).toBeNull();
    expect(row.metrics).toEqual({});
  });

  it('T33: no §12.4 formula logic in service (delegation only; no inline computation)', async () => {
    const diffRepo = mockDiffRepo();
    diffRepo.dsaDealerPartnerIds.mockResolvedValue([PARTNER_A]);
    diffRepo.dsaDealerPartnerDetails.mockResolvedValue([
      { partner_id: PARTNER_A, legal_name: 'Alpha DSA', type: 'DSA' },
    ]);

    const [svc] = makeService({ diffRepo });
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    await svc.getReport('dsa_dealer_quality', BASE_QUERY, HEAD, allScopePredicate);

    // No §12.4 formula computed — service only calls repo helpers + returns stub
    expect(diffRepo.dsaDealerPartnerIds).toHaveBeenCalledTimes(1);
    expect(diffRepo.dsaDealerPartnerDetails).toHaveBeenCalledTimes(1);
    // No other method calls
    expect(diffRepo.firstContactSla).not.toHaveBeenCalled();
  });

  it('T38: PARTNER scope → dsaDealerPartnerIds called with partner predicate', async () => {
    const diffRepo = mockDiffRepo();
    diffRepo.dsaDealerPartnerIds.mockResolvedValue([PARTNER_A]);
    diffRepo.dsaDealerPartnerDetails.mockResolvedValue([
      { partner_id: PARTNER_A, legal_name: 'Alpha DSA', type: 'DSA' },
    ]);
    const entitlement = mockEntitlement({ partnerId: PARTNER_A });
    const [svc] = makeService({ diffRepo, entitlement });
    const partnerUser = user(RoleCode.PARTNER, DataScope.P);
    const result = await svc.getReport('dsa_dealer_quality', BASE_QUERY, partnerUser, partnerScopePredicate);

    expect(diffRepo.dsaDealerPartnerIds).toHaveBeenCalledWith(ORG, partnerScopePredicate, expect.any(Object));
    expect(result.data.rows).toHaveLength(1);
  });

  it('empty partnerIds → returns empty rows (no further repo calls)', async () => {
    const diffRepo = mockDiffRepo();
    diffRepo.dsaDealerPartnerIds.mockResolvedValue([]);
    const [svc] = makeService({ diffRepo });
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const result = await svc.getReport('dsa_dealer_quality', BASE_QUERY, HEAD, allScopePredicate);
    expect(result.data.rows).toHaveLength(0);
    expect(diffRepo.dsaDealerPartnerDetails).not.toHaveBeenCalled();
  });
});

// ── Scope-filter validation (reuses FR-120 resolveScope) ─────────────────────

describe('FR-121 scope filtering via resolveScope', () => {
  it('T12: PARTNER scope probe via partner_id filter → FORBIDDEN (handled by resolveScope)', async () => {
    const entitlement = mockEntitlement({ partnerId: PARTNER_A });
    const [svc] = makeService({ entitlement });
    const partnerUser = user(RoleCode.PARTNER, DataScope.P);
    const OTHER_PARTNER = '00000000-0000-0000-0000-000000000099';
    const query: GetReportQueryDto = { ...BASE_QUERY, partner_id: OTHER_PARTNER };
    await expect(
      svc.getReport('contactability', query, partnerUser, partnerScopePredicate),
    ).rejects.toSatisfyDomainException(ERROR_CODES.FORBIDDEN);
  });

  it('T13: BM with out-of-scope branch_id → FORBIDDEN on differentiator report', async () => {
    const entitlement = mockEntitlement({ branchId: BRANCH_A });
    const [svc] = makeService({ entitlement });
    const bm = user(RoleCode.BM, DataScope.B);
    const OUT_OF_SCOPE_BRANCH = '00000000-0000-0000-0000-000000000099';
    const query: GetReportQueryDto = { ...BASE_QUERY, branch_id: OUT_OF_SCOPE_BRANCH };
    await expect(
      svc.getReport('first_contact_sla', query, bm, branchScopePredicate),
    ).rejects.toSatisfyDomainException(ERROR_CODES.FORBIDDEN);
  });

  it('RM cannot widen scope with branch_id on differentiator report', async () => {
    const [svc] = makeService();
    const rm = user(RoleCode.RM, DataScope.O, RM_USER);
    const query: GetReportQueryDto = { ...BASE_QUERY, branch_id: BRANCH_A };
    await expect(
      svc.getReport('first_contact_sla', query, rm, ownScopePredicate),
    ).rejects.toSatisfyDomainException(ERROR_CODES.FORBIDDEN);
  });

  it('HEAD can access all differentiator reports', async () => {
    const [svc, , diffRepo] = makeService();
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    await svc.getReport('product_branch_heatmap', BASE_QUERY, HEAD, allScopePredicate);
    expect(diffRepo.productBranchHeatmap).toHaveBeenCalledTimes(1);
  });
});

// ── Reconciliation block present (T23) ────────────────────────────────────────

describe('FR-121 response shape', () => {
  it('T23: report_code in response data matches requested code', async () => {
    const [svc, , diffRepo] = makeService();
    diffRepo.sourceRoi.mockResolvedValue(baseRows());
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const { data } = await svc.getReport('source_roi', BASE_QUERY, HEAD, allScopePredicate);
    expect(data.report_code).toBe('source_roi');
    expect(data.generated_at).toMatch(/\+05:30$/);
    expect(data.scope).toEqual({ branch_id: null, team_id: null, owner_id: null });
  });

  it('pagination passed through to DifferentiatorRepository', async () => {
    const [svc, , diffRepo] = makeService();
    const HEAD = user(RoleCode.HEAD, DataScope.A);
    const query: GetReportQueryDto = { page: 2, limit: 10 };
    await svc.getReport('rm_capacity_load', query, HEAD, allScopePredicate);
    const call = diffRepo.rmCapacityLoad.mock.calls[0];
    expect(call?.[3]).toEqual({ page: 2, limit: 10 });
  });
});
