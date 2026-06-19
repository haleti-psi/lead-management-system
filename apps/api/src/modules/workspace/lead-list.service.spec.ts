import { AuditAction, Capability } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { MaskingService } from '../../core/masking';
import type { LeadListRepository, LeadListRow, LeadBoardRow } from './lead-list.repository';
import { LeadListService, type WorkspaceScopeContext } from './lead-list.service';
import { ListLeadsQuerySchema, BoardColumnQuerySchema } from './dto/list-leads.dto';

/**
 * FR-050 — service-level analogues of the deferred API cases: TC-01 (scoped
 * happy path + pagination meta), TC-02 (masked projection; raw PII keys
 * absent), TC-03 (DPO strict masking), TC-05 (PARTNER → FORBIDDEN + audited
 * deny), TC-15 (empty result). The repository (scope SQL) is covered by its
 * own compile tests and mocked here.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const rm: AuthUser = { userId: 'rm-a', orgId: ORG, role: 'RM', scope: 'O', jti: 'j1' };
const dpo: AuthUser = { userId: 'dpo-1', orgId: ORG, role: 'DPO', scope: 'M', jti: 'j2' };
const partner: AuthUser = { userId: 'pu-1', orgId: ORG, role: 'PARTNER', scope: 'P', jti: 'j3' };

function row(overrides: Partial<LeadListRow> = {}): LeadListRow {
  return {
    lead_id: 'lead-1',
    lead_code: 'LD-2026-000123',
    stage: 'documents_pending',
    product_code: 'CV',
    is_hot: true,
    score: 78,
    consent_status: 'captured',
    kyc_status: 'in_progress',
    name: 'Ramesh Kumar',
    mobile: '9812345610',
    pan_masked: 'ABCxxxx1F',
    ...overrides,
  };
}

interface Harness {
  service: LeadListService;
  repo: { list: jest.Mock };
  audit: { append: jest.Mock };
}

function makeHarness(rows: LeadListRow[] = [row()], total = rows.length): Harness {
  const repo = { list: jest.fn().mockResolvedValue({ rows, total }) };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  const service = new LeadListService(
    repo as unknown as LeadListRepository,
    new MaskingService(),
    audit as unknown as AuditAppender,
    logger as unknown as ConstructorParameters<typeof LeadListService>[3],
  );
  return { service, repo, audit };
}

const query = (input: Record<string, unknown> = {}) => ListLeadsQuerySchema.parse(input);
const ownCtx: WorkspaceScopeContext = {
  effectiveScope: 'O',
  predicate: { type: 'own', userId: 'rm-a' },
  maskingLevel: 'partial',
};

describe('LeadListService.list', () => {
  it('TC-01: returns contract-shaped rows + scope-filtered pagination meta', async () => {
    const { service, repo } = makeHarness([row()], 3);
    const result = await service.list(rm, query(), ownCtx);

    expect(repo.list).toHaveBeenCalledWith(ORG, ownCtx.predicate, expect.objectContaining({ page: 1, limit: 25 }));
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 3 });
    expect(result.data[0]).toEqual({
      lead_id: 'lead-1',
      lead_code: 'LD-2026-000123',
      stage: 'documents_pending',
      product_code: 'CV',
      is_hot: true,
      score: 78,
      consent_status: 'captured',
      kyc_status: 'in_progress',
      name_masked: 'Ramesh Kumar',
      mobile_masked: '98xxxxxx10',
    });
  });

  it('TC-02: raw name/mobile/pan are NEVER serialised — only masked projections', async () => {
    const { service } = makeHarness();
    const result = await service.list(rm, query(), ownCtx);
    const item = result.data[0];
    expect(item).toBeDefined();
    const keys = Object.keys(item ?? {});
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('mobile');
    expect(keys).not.toContain('pan_masked');
    expect(keys).not.toContain('pan_token');
    expect(keys).not.toContain('gstin');
    expect(item?.mobile_masked).toBe('98xxxxxx10');
    expect(JSON.stringify(result)).not.toContain('9812345610');
  });

  it('TC-03: DPO (scope M, strict) gets the strictest mask — first name only', async () => {
    const { service, repo } = makeHarness();
    const dpoCtx: WorkspaceScopeContext = {
      effectiveScope: 'M',
      predicate: { type: 'masked', orgId: ORG },
      maskingLevel: 'strict',
    };
    const result = await service.list(dpo, query(), dpoCtx);
    expect(repo.list).toHaveBeenCalledWith(ORG, dpoCtx.predicate, expect.anything());
    expect(result.data[0]?.name_masked).toBe('Ramesh');
    expect(result.data[0]?.mobile_masked).toBe('98xxxxxx10');
  });

  it('TC-05: PARTNER scope is denied with FORBIDDEN and the deny is audited', async () => {
    const { service, repo, audit } = makeHarness();
    const partnerCtx: WorkspaceScopeContext = {
      effectiveScope: 'P',
      predicate: { type: 'partner', partnerId: 'p-9' },
    };
    await expect(service.list(partner, query(), partnerCtx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(repo.list).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ABAC_DENY,
        entity_type: 'leads',
        actor_id: partner.userId,
        org_id: ORG,
        detail: expect.objectContaining({ denied: true, capability: Capability.VIEW_LEAD }),
      }),
    );
  });

  it('a missing predicate is denied (deny-by-default), not served unscoped', async () => {
    const { service, repo } = makeHarness();
    await expect(service.list(rm, query(), {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('an audit-sink failure does not convert the 403 into a 500', async () => {
    const { service, audit } = makeHarness();
    audit.append.mockRejectedValueOnce(new Error('sink down'));
    await expect(
      service.list(partner, query(), { predicate: { type: 'partner', partnerId: 'p-9' } }),
    ).rejects.toMatchObject({ name: 'DomainException', code: 'FORBIDDEN' });
  });

  it('TC-15: an empty queue returns data:[] with total 0 (200, not an error)', async () => {
    const { service } = makeHarness([], 0);
    const result = await service.list(rm, query({ filter: { stage: 'rejected' } }), ownCtx);
    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('passes the clamped limit through to pagination meta (TC-10 meta slice)', async () => {
    const { service } = makeHarness([], 150);
    const result = await service.list(
      { ...rm, role: 'HEAD', scope: 'A' },
      query({ limit: 500 }),
      { effectiveScope: 'A', predicate: { type: 'all', orgId: ORG }, maskingLevel: 'partial' },
    );
    expect(result.pagination).toEqual({ page: 1, limit: 100, total: 150 });
  });
});

describe('LeadListService.boardColumn', () => {
  function boardRow(overrides: Partial<LeadBoardRow> = {}): LeadBoardRow {
    return {
      lead_id: 'lead-1',
      lead_code: 'LD-2026-000123',
      stage: 'assigned',
      product_code: 'CV',
      is_hot: true,
      score: 78,
      consent_status: 'captured',
      kyc_status: 'in_progress',
      requested_amount: '500000.00',
      created_at: new Date(Date.now() - 3 * 86_400_000),
      version: 4,
      name: 'Ramesh Kumar',
      mobile: '9812345610',
      owner_full_name: 'Anita Sharma',
      ...overrides,
    };
  }

  function makeBoardHarness(rows: LeadBoardRow[] = [boardRow()], total = rows.length) {
    const repo = { boardColumn: jest.fn().mockResolvedValue({ rows, total }) };
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const service = new LeadListService(
      repo as unknown as LeadListRepository,
      new MaskingService(),
      audit as unknown as AuditAppender,
      logger as unknown as ConstructorParameters<typeof LeadListService>[3],
    );
    return { service, repo, audit };
  }

  const boardQuery = (input: Record<string, unknown> = { stage: 'assigned' }) =>
    BoardColumnQuerySchema.parse(input);

  it('returns a masked, enriched card (amount/owner/ageing/version); raw PII never serialised', async () => {
    const { service, repo } = makeBoardHarness([boardRow()], 5);
    const result = await service.boardColumn(rm, boardQuery(), ownCtx);

    expect(repo.boardColumn).toHaveBeenCalledWith(ORG, ownCtx.predicate, 'assigned', 1, 25);
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 5 });
    expect(result.data[0]).toMatchObject({
      lead_code: 'LD-2026-000123',
      name_masked: 'Ramesh Kumar',
      mobile_masked: '98xxxxxx10',
      requested_amount: '500000.00',
      owner_name: 'Anita Sharma',
      ageing_days: 3,
      version: 4,
    });
    expect(Object.keys(result.data[0] ?? {})).not.toContain('name');
    expect(JSON.stringify(result)).not.toContain('9812345610');
  });

  it('denies a non-internal (PARTNER) scope with FORBIDDEN + audited deny', async () => {
    const { service, repo, audit } = makeBoardHarness();
    await expect(
      service.boardColumn(partner, boardQuery(), { predicate: { type: 'partner', partnerId: 'p-9' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.boardColumn).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledTimes(1);
  });
});

describe('LeadListService.dashboardMetrics', () => {
  function makeMetricsHarness(pipelineValue = '0', recentCreatedAt: Date[] = [], recentConversions: Date[] = []) {
    const repo = {
      dashboardMetrics: jest.fn().mockResolvedValue({ pipelineValue, recentCreatedAt, recentConversions }),
    };
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const service = new LeadListService(
      repo as unknown as LeadListRepository,
      new MaskingService(),
      audit as unknown as AuditAppender,
      logger as unknown as ConstructorParameters<typeof LeadListService>[3],
    );
    return { service, repo, audit };
  }

  it('returns the scoped pipeline value + 14-day captures and conversions series', async () => {
    const { service, repo } = makeMetricsHarness('1250000.00', [new Date(), new Date()], [new Date()]);
    const result = await service.dashboardMetrics(rm, ownCtx);

    expect(repo.dashboardMetrics).toHaveBeenCalledWith(ORG, ownCtx.predicate, expect.any(Date));
    expect(result.pipeline_value).toBe('1250000.00');
    expect(result.captured_series).toHaveLength(14);
    expect(result.captured_series.reduce((sum, b) => sum + b.count, 0)).toBe(2);
    expect(result.conversions_series).toHaveLength(14);
    expect(result.conversions_series.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it('denies a non-internal (PARTNER) scope with FORBIDDEN', async () => {
    const { service, repo } = makeMetricsHarness();
    await expect(
      service.dashboardMetrics(partner, { predicate: { type: 'partner', partnerId: 'p-9' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.dashboardMetrics).not.toHaveBeenCalled();
  });
});
