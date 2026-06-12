import { ERROR_CODES, type ScopePredicate } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import type { AppConfigService } from '../../core/config';
import type { DbTransaction, KyselyDb, UnitOfWork } from '../../core/db';
import type { LeadService } from '../capture/lead.service';
import type { DedupeRepository, PairMatchSnapshot } from './dedupe.repository';
import { MergeLeadDto } from './dto/merge-lead.dto';
import { UnmergeLeadDto } from './dto/unmerge-lead.dto';
import { MergeLeadService } from './merge-lead.service';
import type { MergeLeadRepository, MergeLeadRow } from './merge-lead.repository';

/**
 * FR-021 unit + component tests (FR-021-tests.md): the API-integration tier is
 * exercised at the service level with the AbacGuard predicate mocked and the
 * repositories stubbed — T-001/002/004/006/007/009–013/018–026/028 analogues —
 * plus the Zod layer for T-003/T-005 (the same schemas the controller pipe
 * runs). T-008 (401) and T-027's live throttle are guard-tier behaviours of
 * the deferred Testcontainers wave (manifest stage7.test_strategy), asserted
 * structurally in the controller spec; T-029/T-030's DB-level REVOKEs are
 * likewise deferred — T-030's service-side rule (consent re-parent touches the
 * FK only, A6) is asserted in the repository spec.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const DUP = 'b0000000-0000-0000-0000-00000000000b';
const MASTER = 'a0000000-0000-0000-0000-00000000000a';
const OWNER_RM = 'c0000000-0000-0000-0000-0000000000c1';
const SA_DUP = 'd0000000-0000-0000-0000-0000000000d1';
const TX = { __tx: true } as unknown as DbTransaction;

const DOC_IDS = [
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
];
const CONSENT_IDS = ['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'];
const TASK_IDS = ['30000000-0000-0000-0000-000000000001'];
const SNAPSHOTS: PairMatchSnapshot[] = [
  {
    duplicate_match_id: '40000000-0000-0000-0000-000000000001',
    action: 'warned',
    status: 'open',
    action_by: null,
    action_reason: null,
  },
];

function leadRow(overrides: Partial<MergeLeadRow> = {}): MergeLeadRow {
  return {
    lead_id: DUP,
    org_id: ORG,
    lead_code: 'LD-2026-000123',
    stage: 'contacted',
    branch_id: 'branch-1',
    owner_id: OWNER_RM,
    team_id: 'team-1',
    priority: 'high',
    duplicate_status: 'flagged',
    master_lead_id: null,
    source_attribution_id: SA_DUP,
    version: 5,
    ...overrides,
  };
}

function masterRow(overrides: Partial<MergeLeadRow> = {}): MergeLeadRow {
  return leadRow({
    lead_id: MASTER,
    lead_code: 'LD-2026-000050',
    owner_id: 'rm-master',
    priority: 'normal',
    source_attribution_id: 'd0000000-0000-0000-0000-0000000000d2',
    version: 9,
    ...overrides,
  });
}

function makeUser(role: AuthUser['role'], userId = 'actor-1'): AuthUser {
  return { userId, orgId: ORG, role, scope: 'B', jti: 'jti-1' };
}

const branchPredicate = (branchId: string): ScopePredicate => ({ type: 'branch', branchId });
const teamPredicate = (...userIds: string[]): ScopePredicate => ({ type: 'team', userIds });

function mergeDto(overrides: Partial<MergeLeadDto> = {}): MergeLeadDto {
  return {
    master_lead_id: MASTER,
    reason: 'Same customer, same loan ask',
    field_precedence: 'master',
    expected_version: 5,
    ...overrides,
  };
}

interface Harness {
  service: MergeLeadService;
  repo: {
    findLeadForMerge: jest.Mock;
    hasChildMergedLeads: jest.Mock;
    findOverrideOwner: jest.Mock;
    setAttributionStatus: jest.Mock;
    reparentDocuments: jest.Mock;
    reparentConsents: jest.Mock;
    reparentTasks: jest.Mock;
    restoreDocuments: jest.Mock;
    restoreConsents: jest.Mock;
    restoreTasks: jest.Mock;
    findLatestMergeAudit: jest.Mock;
  };
  matches: { findPairMatches: jest.Mock; resolvePairAsMerged: jest.Mock; reopenMatches: jest.Mock };
  leads: { merge: jest.Mock; unmerge: jest.Mock; recomputeDuplicateStatus: jest.Mock };
  uowRun: jest.Mock;
  configGet: jest.Mock;
}

function makeHarness(): Harness {
  const repo = {
    findLeadForMerge: jest.fn(async (id: string) => (id === MASTER ? masterRow() : leadRow())),
    hasChildMergedLeads: jest.fn().mockResolvedValue(false),
    findOverrideOwner: jest.fn().mockResolvedValue({ user_id: OWNER_RM, branch_id: 'branch-1', status: 'active' }),
    setAttributionStatus: jest.fn().mockResolvedValue(1),
    reparentDocuments: jest.fn().mockResolvedValue(DOC_IDS),
    reparentConsents: jest.fn().mockResolvedValue(CONSENT_IDS),
    reparentTasks: jest.fn().mockResolvedValue(TASK_IDS),
    restoreDocuments: jest.fn().mockResolvedValue(DOC_IDS.length),
    restoreConsents: jest.fn().mockResolvedValue(CONSENT_IDS.length),
    restoreTasks: jest.fn().mockResolvedValue(TASK_IDS.length),
    findLatestMergeAudit: jest.fn().mockResolvedValue(undefined),
  };
  const matches = {
    findPairMatches: jest.fn().mockResolvedValue(SNAPSHOTS),
    resolvePairAsMerged: jest.fn().mockResolvedValue(1),
    reopenMatches: jest.fn().mockResolvedValue(1),
  };
  const leads = {
    merge: jest.fn().mockResolvedValue({ duplicate_version: 6, master_version: 10 }),
    unmerge: jest.fn().mockResolvedValue({ duplicate_version: 7, master_version: 13 }),
    recomputeDuplicateStatus: jest.fn().mockResolvedValue('none'),
  };
  const uowRun = jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX));
  const configGet = jest.fn().mockReturnValue(24);
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  const service = new MergeLeadService(
    {} as unknown as KyselyDb,
    { run: uowRun } as unknown as UnitOfWork,
    repo as unknown as MergeLeadRepository,
    matches as unknown as DedupeRepository,
    leads as unknown as LeadService,
    { get: configGet } as unknown as AppConfigService,
    logger as never,
  );
  return { service, repo, matches, leads, uowRun, configGet };
}

// ───────────────────────────────────────────── merge — happy paths ──────────

describe('MergeLeadService.merge — happy paths', () => {
  it('T-001: BM merges duplicate into master — children re-linked, pair resolved, master recomputed', async () => {
    const h = makeHarness();
    const before = Date.now();

    const result = await h.service.merge(DUP, mergeDto(), makeUser('BM'), {
      predicate: branchPredicate('branch-1'),
    });

    // Child re-parents, all inside the single UnitOfWork tx (same TX handle).
    expect(h.repo.setAttributionStatus).toHaveBeenCalledWith(SA_DUP, 'merged_into', ORG, 'actor-1', TX);
    expect(h.repo.reparentDocuments).toHaveBeenCalledWith(DUP, MASTER, ORG, 'actor-1', TX);
    expect(h.repo.reparentConsents).toHaveBeenCalledWith(DUP, MASTER, ORG, TX);
    expect(h.repo.reparentTasks).toHaveBeenCalledWith(DUP, MASTER, ORG, 'actor-1', TX);
    expect(h.matches.resolvePairAsMerged).toHaveBeenCalledWith(DUP, MASTER, ORG, 'actor-1', mergeDto().reason, TX);

    // The two `leads` writes go through the sole writer with both locks.
    expect(h.leads.merge).toHaveBeenCalledWith(
      MASTER,
      DUP,
      mergeDto().reason,
      expect.objectContaining({
        org_id: ORG,
        actor_id: 'actor-1',
        expected_duplicate_version: 5,
        expected_master_version: 9,
        master_updates: {},
      }),
      TX,
    );
    // FR-020's recompute runs for the MASTER with its post-merge version.
    expect(h.leads.recomputeDuplicateStatus).toHaveBeenCalledWith(MASTER, ORG, 'actor-1', 10, TX);

    expect(result).toMatchObject({
      master_lead_id: MASTER,
      duplicate_lead_id: DUP,
      attribution_records_relinked: 1,
      documents_relinked: 3,
      consent_records_relinked: 2,
      tasks_relinked: 1,
      duplicate_match_resolved: true,
    });
    // unmerge_allowed_until = merge time + MERGE_UNMERGE_WINDOW_HOURS (24).
    expect(h.configGet).toHaveBeenCalledWith('MERGE_UNMERGE_WINDOW_HOURS');
    const until = new Date(result.unmerge_allowed_until as string).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3_600_000 - 5_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000 + 5_000);
  });

  it('T-001/E3: the audit detail passed to LeadService.merge carries relinked_ids, counts and the window', async () => {
    const h = makeHarness();
    await h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') });

    const input = h.leads.merge.mock.calls[0]?.[3] as { audit_detail: Record<string, unknown> };
    expect(input.audit_detail).toMatchObject({
      field_precedence: 'master',
      attribution_records_relinked: 1,
      documents_relinked: 3,
      consent_records_relinked: 2,
      tasks_relinked: 1,
      duplicate_match_resolved: true,
      relinked_ids: { documents: DOC_IDS, consents: CONSENT_IDS, tasks: TASK_IDS },
      duplicate_match_snapshots: SNAPSHOTS,
    });
    expect(typeof input.audit_detail['unmerge_allowed_until']).toBe('string');
  });

  it('T-002: SM merges within team scope (both owners in the team)', async () => {
    const h = makeHarness();
    const result = await h.service.merge(DUP, mergeDto(), makeUser('SM'), {
      predicate: teamPredicate(OWNER_RM, 'rm-master'),
    });
    expect(result.duplicate_lead_id).toBe(DUP);
    expect(h.leads.merge).toHaveBeenCalled();
  });

  it('T-028 analogue: the response carries ids/counts/timestamps only — no PII fields', () => {
    const h = makeHarness();
    return h.service
      .merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') })
      .then((result) => {
        expect(Object.keys(result).sort()).toEqual([
          'attribution_records_relinked',
          'consent_records_relinked',
          'documents_relinked',
          'duplicate_lead_id',
          'duplicate_match_resolved',
          'master_lead_id',
          'merge_completed_at',
          'tasks_relinked',
          'unmerge_allowed_until',
        ]);
      });
  });

  it('reports duplicate_match_resolved=false when no duplicate_matches row linked the pair', async () => {
    const h = makeHarness();
    h.matches.findPairMatches.mockResolvedValue([]);
    h.matches.resolvePairAsMerged.mockResolvedValue(0);
    const result = await h.service.merge(DUP, mergeDto(), makeUser('BM'), {
      predicate: branchPredicate('branch-1'),
    });
    expect(result.duplicate_match_resolved).toBe(false);
  });
});

// ─────────────────────────────────────── merge — field precedence ───────────

describe('MergeLeadService.merge — field precedence (T-018/019/020)', () => {
  it('T-018: field_precedence=master → no master field updates (master values win)', async () => {
    const h = makeHarness();
    await h.service.merge(DUP, mergeDto({ field_precedence: 'master' }), makeUser('BM'), {
      predicate: branchPredicate('branch-1'),
    });
    const input = h.leads.merge.mock.calls[0]?.[3] as { master_updates: Record<string, unknown> };
    expect(input.master_updates).toEqual({});
  });

  it('T-019: field_precedence=duplicate → master adopts the duplicate non-null owner/priority', async () => {
    const h = makeHarness();
    await h.service.merge(DUP, mergeDto({ field_precedence: 'duplicate' }), makeUser('BM'), {
      predicate: branchPredicate('branch-1'),
    });
    const input = h.leads.merge.mock.calls[0]?.[3] as { master_updates: Record<string, unknown> };
    expect(input.master_updates).toEqual({ owner_id: OWNER_RM, priority: 'high' });
  });

  it('T-019: a null duplicate owner is NOT adopted (non-null values only)', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockImplementation(async (id: string) =>
      id === MASTER ? masterRow() : leadRow({ owner_id: null }),
    );
    await h.service.merge(DUP, mergeDto({ field_precedence: 'duplicate' }), makeUser('BM'), {
      predicate: branchPredicate('branch-1'),
    });
    const input = h.leads.merge.mock.calls[0]?.[3] as { master_updates: Record<string, unknown> };
    expect(input.master_updates).toEqual({ priority: 'high' });
  });

  it('T-020: cross-branch merge — branch_id is NEVER taken from the duplicate (master branch precedence)', async () => {
    const h = makeHarness();
    // HEAD-like wide scope so both branches pass row scope; duplicate sits in branch-A.
    h.repo.findLeadForMerge.mockImplementation(async (id: string) =>
      id === MASTER ? masterRow({ branch_id: 'branch-B' }) : leadRow({ branch_id: 'branch-A' }),
    );
    await h.service.merge(DUP, mergeDto({ field_precedence: 'duplicate' }), makeUser('SM'), {
      predicate: { type: 'all', orgId: ORG },
    });
    const input = h.leads.merge.mock.calls[0]?.[3] as { master_updates: Record<string, unknown> };
    expect(input.master_updates['branch_id']).toBeUndefined();
  });

  it('manual: writes the validated owner override (+ branch when provided)', async () => {
    const h = makeHarness();
    h.repo.findOverrideOwner.mockResolvedValue({ user_id: OWNER_RM, branch_id: 'branch-2', status: 'active' });
    await h.service.merge(
      DUP,
      mergeDto({ field_precedence: 'manual', manual_overrides: { owner_id: OWNER_RM, branch_id: 'branch-2' } }),
      makeUser('BM'),
      { predicate: branchPredicate('branch-1') },
    );
    const input = h.leads.merge.mock.calls[0]?.[3] as { master_updates: Record<string, unknown> };
    expect(input.master_updates).toEqual({ owner_id: OWNER_RM, branch_id: 'branch-2' });
  });

  it.each([
    ['unknown user', undefined],
    ['inactive user', { user_id: OWNER_RM, branch_id: 'branch-1', status: 'inactive' }],
    ['user outside the merged branch', { user_id: OWNER_RM, branch_id: 'branch-9', status: 'active' }],
  ])('manual override owner invalid (%s) → 400 VALIDATION_ERROR on manual_overrides.owner_id', async (_name, owner) => {
    const h = makeHarness();
    h.repo.findOverrideOwner.mockResolvedValue(owner);
    await expect(
      h.service.merge(
        DUP,
        mergeDto({ field_precedence: 'manual', manual_overrides: { owner_id: OWNER_RM } }),
        makeUser('BM'),
        { predicate: branchPredicate('branch-1') },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [expect.objectContaining({ field: 'manual_overrides.owner_id' })],
    });
    expect(h.uowRun).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────── merge — error paths ────────────

describe('MergeLeadService.merge — validation, authz and state errors', () => {
  it('T-004: master_lead_id equals the path id → 400 VALIDATION_ERROR, nothing read or written', async () => {
    const h = makeHarness();
    await expect(
      h.service.merge(DUP, mergeDto({ master_lead_id: DUP }), makeUser('BM'), {
        predicate: branchPredicate('branch-1'),
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [expect.objectContaining({ field: 'master_lead_id' })],
    });
    expect(h.repo.findLeadForMerge).not.toHaveBeenCalled();
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it.each(['RM', 'KYC', 'HEAD'] as const)('T-006: %s is not a merge role → 403 FORBIDDEN', async (role) => {
    const h = makeHarness();
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser(role), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('T-007: BM whose branch covers neither lead → 403 FORBIDDEN', async () => {
    const h = makeHarness();
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-OTHER') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('cross-branch master outside the actor scope → 403 (scope must cover BOTH leads)', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockImplementation(async (id: string) =>
      id === MASTER ? masterRow({ branch_id: 'branch-B' }) : leadRow({ branch_id: 'branch-1' }),
    );
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('duplicate lead not found → 404 NOT_FOUND', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockImplementation(async (id: string) => (id === MASTER ? masterRow() : undefined));
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('master lead not found → 404 NOT_FOUND', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockImplementation(async (id: string) => (id === MASTER ? undefined : leadRow()));
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('T-009: duplicate already merged → 409 CONFLICT', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockImplementation(async (id: string) =>
      id === MASTER ? masterRow() : leadRow({ duplicate_status: 'merged', master_lead_id: MASTER }),
    );
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('T-010: master itself merged (chained merge) → 409 CONFLICT', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockImplementation(async (id: string) =>
      id === MASTER ? masterRow({ duplicate_status: 'merged', master_lead_id: 'x0000000-0000-0000-0000-0000000000x' }) : leadRow(),
    );
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('INV-008 guard: merging a lead that is the master of earlier merges → 409 CONFLICT', async () => {
    const h = makeHarness();
    h.repo.hasChildMergedLeads.mockResolvedValue(true);
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('T-011/T-012: optimistic-lock CONFLICT from LeadService.merge propagates and aborts the tx', async () => {
    const h = makeHarness();
    h.leads.merge.mockRejectedValue(
      Object.assign(new Error('conflict'), { code: ERROR_CODES.CONFLICT }),
    );
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    // The recompute never runs — the transaction callback rethrew (full rollback).
    expect(h.leads.recomputeDuplicateStatus).not.toHaveBeenCalled();
  });

  it('T-013: a mid-write failure (consents step) aborts before the leads write — full rollback, no audit/outbox', async () => {
    const h = makeHarness();
    h.repo.reparentConsents.mockRejectedValue(new Error('db down'));
    await expect(
      h.service.merge(DUP, mergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toThrow('db down');
    expect(h.repo.reparentDocuments).toHaveBeenCalled(); // documents step ran…
    expect(h.leads.merge).not.toHaveBeenCalled(); // …but no leads write, hence no audit/outbox
    expect(h.leads.recomputeDuplicateStatus).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────── unmerge ───────────

function mergeAuditRow(detailOverrides: Record<string, unknown> = {}): {
  audit_id: string;
  detail: Record<string, unknown>;
  created_at: Date;
} {
  return {
    audit_id: '90000000-0000-0000-0000-000000000001',
    detail: {
      action: 'merged',
      duplicate_lead_id: DUP,
      unmerge_allowed_until: new Date(Date.now() + 3_600_000).toISOString(),
      relinked_ids: { documents: DOC_IDS, consents: CONSENT_IDS, tasks: TASK_IDS },
      duplicate_match_snapshots: SNAPSHOTS,
      ...detailOverrides,
    },
    created_at: new Date(),
  };
}

function unmergeDto(overrides: Partial<UnmergeLeadDto> = {}): UnmergeLeadDto {
  return { reason: 'Merged in error', expected_master_version: 10, ...overrides };
}

const mergedLead = (overrides: Partial<MergeLeadRow> = {}): MergeLeadRow =>
  leadRow({ duplicate_status: 'merged', master_lead_id: MASTER, version: 6, ...overrides });

describe('MergeLeadService.unmerge', () => {
  it('T-023: BM unmerges within the window — children restored, pair re-opened, lead restored', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(mergedLead());
    h.repo.findLatestMergeAudit.mockResolvedValue(mergeAuditRow());

    const result = await h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), {
      predicate: branchPredicate('branch-1'),
    });

    expect(h.repo.findLatestMergeAudit).toHaveBeenCalledWith(MASTER, DUP, ORG, expect.anything());
    expect(h.repo.setAttributionStatus).toHaveBeenCalledWith(SA_DUP, 'original', ORG, 'actor-1', TX);
    expect(h.repo.restoreDocuments).toHaveBeenCalledWith(DOC_IDS, MASTER, DUP, ORG, 'actor-1', TX);
    expect(h.repo.restoreConsents).toHaveBeenCalledWith(CONSENT_IDS, MASTER, DUP, ORG, TX);
    expect(h.repo.restoreTasks).toHaveBeenCalledWith(TASK_IDS, MASTER, DUP, ORG, 'actor-1', TX);
    // Pair rows restored from the audit snapshot (pre-merge action, not 'merged').
    expect(h.matches.reopenMatches).toHaveBeenCalledWith(SNAPSHOTS, ORG, 'actor-1', TX);
    expect(h.leads.unmerge).toHaveBeenCalledWith(
      DUP,
      MASTER,
      'Merged in error',
      expect.objectContaining({ org_id: ORG, actor_id: 'actor-1', expected_master_version: 10 }),
      TX,
    );

    expect(result).toMatchObject({
      unmerged_lead_id: DUP,
      master_lead_id: MASTER,
      attribution_records_restored: 1,
      documents_restored: 3,
      consent_records_restored: 2,
      tasks_restored: 1,
    });
  });

  it('T-026: only the originally relinked ids are restored — exactly the audit-detail lists are passed', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(mergedLead());
    // Master gained a new document after the merge; it is NOT in relinked_ids.
    const originalDocs = DOC_IDS.slice(0, 2);
    h.repo.findLatestMergeAudit.mockResolvedValue(
      mergeAuditRow({ relinked_ids: { documents: originalDocs, consents: [], tasks: [] } }),
    );

    await h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') });

    expect(h.repo.restoreDocuments).toHaveBeenCalledWith(originalDocs, MASTER, DUP, ORG, 'actor-1', TX);
    expect(h.repo.restoreConsents).toHaveBeenCalledWith([], MASTER, DUP, ORG, TX);
    expect(h.repo.restoreTasks).toHaveBeenCalledWith([], MASTER, DUP, ORG, 'actor-1', TX);
  });

  it('T-024: window expired → 403 FORBIDDEN, nothing restored', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(mergedLead());
    h.repo.findLatestMergeAudit.mockResolvedValue(
      mergeAuditRow({ unmerge_allowed_until: new Date(Date.now() - 60_000).toISOString() }),
    );
    await expect(
      h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('T-025: lead not in merged state → 400 VALIDATION_ERROR', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(leadRow({ duplicate_status: 'none' }));
    await expect(
      h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Lead is not in merged state' });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('role outside BM/SM → 403; out-of-scope merged lead → 403', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(mergedLead());
    h.repo.findLatestMergeAudit.mockResolvedValue(mergeAuditRow());
    await expect(
      h.service.unmerge(DUP, unmergeDto(), makeUser('RM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    await expect(
      h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-OTHER') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('no merge audit record for the pair → 409 CONFLICT (cannot restore safely)', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(mergedLead());
    h.repo.findLatestMergeAudit.mockResolvedValue(undefined);
    await expect(
      h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('unreadable merge audit detail → 500 INTERNAL_ERROR (fail loudly, restore nothing)', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(mergedLead());
    h.repo.findLatestMergeAudit.mockResolvedValue({
      audit_id: '90000000-0000-0000-0000-000000000001',
      detail: { unexpected: true },
      created_at: new Date(),
    });
    await expect(
      h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('mid-restore failure aborts before the leads write (atomicity analogue of T-013)', async () => {
    const h = makeHarness();
    h.repo.findLeadForMerge.mockResolvedValue(mergedLead());
    h.repo.findLatestMergeAudit.mockResolvedValue(mergeAuditRow());
    h.repo.restoreConsents.mockRejectedValue(new Error('db down'));
    await expect(
      h.service.unmerge(DUP, unmergeDto(), makeUser('BM'), { predicate: branchPredicate('branch-1') }),
    ).rejects.toThrow('db down');
    expect(h.leads.unmerge).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── DTO layer (T-003/T-004/T-005 + bounds) ─────

describe('MergeLeadDto (Zod — the controller pipe schema)', () => {
  const valid = {
    master_lead_id: MASTER,
    reason: 'Same customer',
    field_precedence: 'master',
    expected_version: 5,
  };

  it('accepts a valid payload (and a 500-char reason boundary)', () => {
    expect(MergeLeadDto.safeParse(valid).success).toBe(true);
    expect(MergeLeadDto.safeParse({ ...valid, reason: 'r'.repeat(500) }).success).toBe(true);
  });

  it('T-003: missing reason → issue on the reason field', () => {
    const result = MergeLeadDto.safeParse({ ...valid, reason: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('reason');
    }
  });

  it('rejects a 501-char reason and a non-positive/non-integer expected_version', () => {
    expect(MergeLeadDto.safeParse({ ...valid, reason: 'r'.repeat(501) }).success).toBe(false);
    expect(MergeLeadDto.safeParse({ ...valid, expected_version: 0 }).success).toBe(false);
    expect(MergeLeadDto.safeParse({ ...valid, expected_version: 1.5 }).success).toBe(false);
  });

  it('rejects a non-UUID master_lead_id and an unknown field_precedence', () => {
    expect(MergeLeadDto.safeParse({ ...valid, master_lead_id: 'not-a-uuid' }).success).toBe(false);
    expect(MergeLeadDto.safeParse({ ...valid, field_precedence: 'newest' }).success).toBe(false);
  });

  it('T-005: field_precedence=manual without manual_overrides → issue on manual_overrides.owner_id', () => {
    const result = MergeLeadDto.safeParse({ ...valid, field_precedence: 'manual' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('manual_overrides.owner_id');
    }
  });

  it('manual with a valid owner_id (and optional branch_id) parses', () => {
    expect(
      MergeLeadDto.safeParse({
        ...valid,
        field_precedence: 'manual',
        manual_overrides: { owner_id: OWNER_RM, branch_id: 'e0000000-0000-0000-0000-0000000000e1' },
      }).success,
    ).toBe(true);
  });
});

describe('UnmergeLeadDto (Zod)', () => {
  it('accepts a valid payload; rejects missing reason / bad expected_master_version', () => {
    expect(UnmergeLeadDto.safeParse({ reason: 'undo', expected_master_version: 3 }).success).toBe(true);
    expect(UnmergeLeadDto.safeParse({ expected_master_version: 3 }).success).toBe(false);
    expect(UnmergeLeadDto.safeParse({ reason: '', expected_master_version: 3 }).success).toBe(false);
    expect(UnmergeLeadDto.safeParse({ reason: 'undo', expected_master_version: -1 }).success).toBe(false);
  });
});
