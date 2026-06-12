import { DataScope, ERROR_CODES } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import type { DbTransaction, KyselyDb, UnitOfWork } from '../../core/db';
import type { SlaEngine } from '../../core/sla';
import type { LeadService } from '../capture/lead.service';
import {
  AllocationService,
  criteriaMatches,
  pickCandidate,
  type AllocationScopeContext,
} from './allocation.service';
import type {
  AllocationRuleRepository,
  AllocationRuleRow,
  CandidateRm,
  LeadAllocationContext,
} from './allocation-rule.repository';
import { CreateAllocationRuleDto } from './dto/create-allocation-rule.dto';
import { ReassignLeadDto } from './dto/reassign-lead.dto';

/**
 * FR-030 unit + component tests (FR-030-tests.md T01–T10 plus service-level
 * analogues of the deferred API tier: T12–T14/T33 at the Zod layer, T17–T23 at
 * the service layer with the AbacGuard predicate mocked; T11/T15/T16/T24–T32/
 * T34/T35 full-HTTP+DB assertions are the deferred Testcontainers wave —
 * manifest stage7.test_strategy).
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const SYSTEM = '00000000-0000-0000-0000-000000000000';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const DUE_AT = new Date('2026-06-15T09:00:00Z');
const TX = { __tx: true } as unknown as DbTransaction;

// ── builders ──────────────────────────────────────────────────────────────────

function rule(overrides: Partial<AllocationRuleRow> = {}): AllocationRuleRow {
  return {
    allocation_rule_id: 'rule-1',
    org_id: ORG,
    name: 'CV Branch Rule',
    priority_order: 1,
    method: 'round_robin',
    criteria: { product_code: 'CV' },
    target: { team_ids: ['team-1'] },
    capacity_limit: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    created_by: SYSTEM,
    updated_by: SYSTEM,
    ...overrides,
  };
}

function leadCtx(overrides: Partial<LeadAllocationContext> = {}): LeadAllocationContext {
  return {
    lead_id: LEAD,
    org_id: ORG,
    lead_code: 'LD-2026-000123',
    stage: 'captured',
    branch_id: 'branch-1',
    owner_id: null,
    team_id: null,
    version: 1,
    product_code: 'CV',
    priority: 'normal',
    is_hot: false,
    source: 'DSA',
    partner_id: 'partner-9',
    preferred_language: 'Hindi',
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<CandidateRm> = {}): CandidateRm {
  return {
    user_id: id,
    team_id: 'team-1',
    branch_id: 'branch-1',
    partner_id: null,
    product_skills: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface Harness {
  service: AllocationService;
  repo: {
    findActiveRules: jest.Mock;
    listRules: jest.Mock;
    countRules: jest.Mock;
    insertRule: jest.Mock;
    findLeadAllocationContext: jest.Mock;
    findTeamCandidates: jest.Mock;
    findPartnerCandidates: jest.Mock;
    findEscalationCandidates: jest.Mock;
    activeLeadCounts: jest.Mock;
    findBranchDefaultTeam: jest.Mock;
    findActiveUser: jest.Mock;
  };
  leads: { assignOwner: jest.Mock };
  sla: { computeDueAt: jest.Mock };
  uowRun: jest.Mock;
  logger: { warn: jest.Mock; error: jest.Mock; info: jest.Mock; debug: jest.Mock };
}

function makeHarness(): Harness {
  const repo = {
    findActiveRules: jest.fn().mockResolvedValue([]),
    listRules: jest.fn().mockResolvedValue([]),
    countRules: jest.fn().mockResolvedValue(0),
    insertRule: jest.fn(),
    findLeadAllocationContext: jest.fn().mockResolvedValue(leadCtx()),
    findTeamCandidates: jest.fn().mockResolvedValue([]),
    findPartnerCandidates: jest.fn().mockResolvedValue([]),
    findEscalationCandidates: jest.fn().mockResolvedValue([]),
    activeLeadCounts: jest.fn().mockResolvedValue(new Map<string, number>()),
    findBranchDefaultTeam: jest.fn().mockResolvedValue(undefined),
    findActiveUser: jest.fn().mockResolvedValue(undefined),
  };
  const leads = {
    // Echo the input back as the post-write lead state (sole-writer contract).
    assignOwner: jest.fn(
      async (
        leadId: string,
        input: { ownerId: string | null; teamId?: string | null; expectedVersion: number },
      ) => ({
        lead_id: leadId,
        owner_id: input.ownerId,
        team_id: input.teamId ?? null,
        stage: input.ownerId === null ? 'captured' : 'assigned',
        version: input.expectedVersion + 1,
      }),
    ),
  };
  const sla = { computeDueAt: jest.fn().mockResolvedValue({ dueAt: DUE_AT, policyId: 'pol-1' }) };
  const uowRun = jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX));
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };

  const service = new AllocationService(
    {} as unknown as KyselyDb,
    { run: uowRun } as unknown as UnitOfWork,
    leads as unknown as LeadService,
    repo as unknown as AllocationRuleRepository,
    sla as unknown as SlaEngine,
    logger as never,
  );
  return { service, repo, leads, sla, uowRun, logger };
}

const trigger = { leadId: LEAD, orgId: ORG, actorId: SYSTEM, expectedVersion: 1 };

const bmUser: AuthUser = { userId: 'bm-1', orgId: ORG, role: 'BM', scope: DataScope.B, jti: 'j1' } as AuthUser;
const bmScope: AllocationScopeContext = {
  effectiveScope: DataScope.B,
  predicate: { type: 'branch', branchId: 'branch-1' },
};
const smScope: AllocationScopeContext = {
  effectiveScope: DataScope.T,
  predicate: { type: 'team', userIds: ['rm-1', 'rm-2'] },
};

// ── Path A — automatic allocation ─────────────────────────────────────────────

describe('AllocationService.allocate (T01–T08)', () => {
  it('T01: round_robin with equal load picks the earlier-created RM (deterministic tie-break)', async () => {
    const h = makeHarness();
    h.repo.findActiveRules.mockResolvedValue([rule()]);
    h.repo.findTeamCandidates.mockResolvedValue([
      candidate('rm-late', { created_at: new Date('2026-02-01T00:00:00Z') }),
      candidate('rm-early', { created_at: new Date('2026-01-01T00:00:00Z') }),
    ]);
    h.repo.activeLeadCounts.mockResolvedValue(new Map([['rm-late', 3], ['rm-early', 3]]));

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome.ownerId).toBe('rm-early');
    expect(outcome.method).toBe('round_robin');
    expect(h.leads.assignOwner).toHaveBeenCalledWith(
      LEAD,
      expect.objectContaining({
        ownerId: 'rm-early',
        teamId: 'team-1',
        method: 'round_robin',
        actorId: SYSTEM,
        expectedVersion: 1,
        auditAction: 'allocate',
        slaFirstContactDueAt: DUE_AT,
        detail: { allocation_rule_id: 'rule-1' },
      }),
      TX,
    );
  });

  it('T02: first matching rule with all RMs at capacity falls through to the second rule', async () => {
    const h = makeHarness();
    const r1 = rule({
      allocation_rule_id: 'rule-1',
      priority_order: 1,
      criteria: { product_code: 'CV', source: 'DSA' },
      target: { team_ids: ['team-1'] },
      capacity_limit: 2,
    });
    const r2 = rule({
      allocation_rule_id: 'rule-2',
      priority_order: 2,
      criteria: { product_code: 'CV' },
      target: { team_ids: ['team-2'] },
      capacity_limit: null,
    });
    h.repo.findActiveRules.mockResolvedValue([r1, r2]);
    h.repo.findTeamCandidates
      .mockResolvedValueOnce([candidate('rm-a'), candidate('rm-b')]) // rule-1 pool
      .mockResolvedValueOnce([candidate('rm-c', { team_id: 'team-2' })]); // rule-2 pool
    h.repo.activeLeadCounts
      .mockResolvedValueOnce(new Map([['rm-a', 2], ['rm-b', 2]])) // both AT capacity_limit=2
      .mockResolvedValueOnce(new Map([['rm-c', 7]]));

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome.ownerId).toBe('rm-c');
    expect(outcome.allocationRuleId).toBe('rule-2');
    expect(h.repo.findTeamCandidates).toHaveBeenCalledTimes(2);
  });

  it('T03: method=capacity picks the RM with the lowest active-lead count below the limit', async () => {
    const h = makeHarness();
    h.repo.findActiveRules.mockResolvedValue([rule({ method: 'capacity', capacity_limit: 10 })]);
    h.repo.findTeamCandidates.mockResolvedValue([candidate('rm-a'), candidate('rm-b')]);
    h.repo.activeLeadCounts.mockResolvedValue(new Map([['rm-a', 5], ['rm-b', 2]]));

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome.ownerId).toBe('rm-b');
  });

  it('T04: method=specialist filters the pool by users.product_skills containing the lead product', async () => {
    const h = makeHarness();
    h.repo.findActiveRules.mockResolvedValue([rule({ method: 'specialist' })]);
    h.repo.findTeamCandidates.mockResolvedValue([
      candidate('rm-generalist', { product_skills: ['CAR', 'TW'] }),
      candidate('rm-specialist', { product_skills: ['CV'] }),
    ]);
    h.repo.activeLeadCounts.mockResolvedValue(new Map([['rm-generalist', 0], ['rm-specialist', 9]]));

    const outcome = await h.service.allocate(trigger, TX);

    // Despite the higher load, only the CV specialist is eligible.
    expect(outcome.ownerId).toBe('rm-specialist');
  });

  it('T05: method=partner resolves the pool from users dedicated to target.partner_id', async () => {
    const h = makeHarness();
    h.repo.findActiveRules.mockResolvedValue([
      rule({ method: 'partner', criteria: { partner_id: 'partner-9' }, target: { partner_id: 'partner-9' } }),
    ]);
    h.repo.findPartnerCandidates.mockResolvedValue([
      candidate('rm-partner', { partner_id: 'partner-9', team_id: 'team-p' }),
    ]);

    const outcome = await h.service.allocate(trigger, TX);

    expect(h.repo.findPartnerCandidates).toHaveBeenCalledWith(ORG, 'partner-9', TX);
    expect(outcome.ownerId).toBe('rm-partner');
    expect(outcome.teamId).toBe('team-p');
  });

  it('T06: method=escalation resolves the team manager (teams.manager_id) as the assignee', async () => {
    const h = makeHarness();
    h.repo.findActiveRules.mockResolvedValue([rule({ method: 'escalation' })]);
    h.repo.findEscalationCandidates.mockResolvedValue([
      candidate('mgr-1', { team_id: null, managed_team_id: 'team-1' }),
    ]);

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome.ownerId).toBe('mgr-1');
    // The manager has no own team — attribution falls back to the managed team.
    expect(h.leads.assignOwner).toHaveBeenCalledWith(
      LEAD,
      expect.objectContaining({ ownerId: 'mgr-1', teamId: 'team-1' }),
      TX,
    );
  });

  it('T07: no matching rule → unassigned pool: ownerId=null, reason=no_rule_match, pino warn', async () => {
    const h = makeHarness();
    h.repo.findActiveRules.mockResolvedValue([rule({ criteria: { product_code: 'TRACTOR' } })]);
    h.repo.findBranchDefaultTeam.mockResolvedValue('team-pool');

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome.ownerId).toBeNull();
    expect(outcome.reason).toBe('no_rule_match');
    expect(outcome.stage).toBe('captured'); // INV-01: never 'assigned' without an owner
    // The pool parking goes through the sole writer with the outbox reason.
    expect(h.leads.assignOwner).toHaveBeenCalledWith(
      LEAD,
      expect.objectContaining({ ownerId: null, teamId: 'team-pool', reason: 'unassigned_pool' }),
      TX,
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: LEAD, metric: 'allocation.no_match' }),
      expect.stringContaining('allocation.no_match'),
    );
  });

  it('no-match for an ALREADY-OWNED lead (RM self-capture): no parking, no event, no alert', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx({ owner_id: 'rm-creator' }));
    h.repo.findActiveRules.mockResolvedValue([]); // nothing matches

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome).toMatchObject({ ownerId: 'rm-creator', stage: 'captured', reason: 'no_rule_match' });
    expect(h.leads.assignOwner).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('T08: rules evaluate in strict priority_order — a lower-priority match never wins', async () => {
    const h = makeHarness();
    const r1 = rule({ allocation_rule_id: 'rule-high', priority_order: 1, target: { team_ids: ['team-1'] } });
    const r2 = rule({ allocation_rule_id: 'rule-low', priority_order: 2, target: { team_ids: ['team-2'] } });
    h.repo.findActiveRules.mockResolvedValue([r1, r2]); // repository orders by priority_order ASC
    h.repo.findTeamCandidates.mockResolvedValue([candidate('rm-a')]);

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome.allocationRuleId).toBe('rule-high');
    // The second (also matching) rule was never pooled — first match wins.
    expect(h.repo.findTeamCandidates).toHaveBeenCalledTimes(1);
    expect(h.repo.findTeamCandidates).toHaveBeenCalledWith(ORG, ['team-1'], TX);
  });

  it('sets the first-contact SLA only on the captured → assigned transition (not for dormant reactivation)', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx({ stage: 'dormant', owner_id: 'rm-old', version: 4 }));
    h.repo.findActiveRules.mockResolvedValue([rule()]);
    h.repo.findTeamCandidates.mockResolvedValue([candidate('rm-a')]);

    await h.service.allocate(trigger, TX);

    expect(h.sla.computeDueAt).not.toHaveBeenCalled();
    const input = h.leads.assignOwner.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('slaFirstContactDueAt' in input).toBe(false);
  });

  it('skips the SLA timestamp when no active policy applies (engine returns null)', async () => {
    const h = makeHarness();
    h.sla.computeDueAt.mockResolvedValue(null);
    h.repo.findActiveRules.mockResolvedValue([rule()]);
    h.repo.findTeamCandidates.mockResolvedValue([candidate('rm-a')]);

    const outcome = await h.service.allocate(trigger, TX);

    expect(outcome.ownerId).toBe('rm-a');
    const input = h.leads.assignOwner.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('slaFirstContactDueAt' in input).toBe(false);
  });

  it('throws NOT_FOUND when the lead does not exist (defensive)', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(undefined);
    await expect(h.service.allocate(trigger, TX)).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

// ── Path B — manual reassign ──────────────────────────────────────────────────

describe('AllocationService.reassign (T10, T17–T23 analogues)', () => {
  const dto = ReassignLeadDto.parse({
    new_owner_id: 'c0000000-0000-0000-0000-00000000000c',
    reason: 'Customer requested language-match RM',
  });

  it('T11 analogue: BM reassign within branch — assignOwner runs inside ONE UnitOfWork tx', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx({ version: 3 }));
    h.repo.findActiveUser.mockResolvedValue({ user_id: dto.new_owner_id, branch_id: 'branch-1', team_id: 'team-9' });

    const result = await h.service.reassign(LEAD, dto, bmUser, bmScope);

    expect(h.uowRun).toHaveBeenCalledTimes(1);
    expect(h.leads.assignOwner).toHaveBeenCalledWith(
      LEAD,
      expect.objectContaining({
        ownerId: dto.new_owner_id,
        teamId: 'team-9',
        reason: dto.reason,
        method: 'manual',
        actorId: 'bm-1',
        expectedVersion: 3,
        auditAction: 'reassign',
        slaFirstContactDueAt: DUE_AT, // captured → assigned sets the timer
        detail: { override_capacity: false },
      }),
      TX,
    );
    expect(result).toMatchObject({ owner_id: dto.new_owner_id, stage: 'assigned', version: 4 });
  });

  it('T19 analogue: lead not found → NOT_FOUND', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(undefined);
    await expect(h.service.reassign(LEAD, dto, bmUser, bmScope)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('T20 analogue: lead in terminal handed_off stage → CONFLICT', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx({ stage: 'handed_off' }));
    await expect(h.service.reassign(LEAD, dto, bmUser, bmScope)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(h.leads.assignOwner).not.toHaveBeenCalled();
  });

  it('T17 analogue: BM reassigning a lead of another branch → FORBIDDEN', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx({ branch_id: 'branch-OTHER' }));
    await expect(h.service.reassign(LEAD, dto, bmUser, bmScope)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('SM scope: lead owned outside the team member set → FORBIDDEN (CORRECTIONS §FR-052 semantics)', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx({ owner_id: 'rm-elsewhere' }));
    await expect(h.service.reassign(LEAD, dto, bmUser, smScope)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('T10/T18: SM (scope T) attempting override_capacity=true → FORBIDDEN', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx({ owner_id: 'rm-1' })); // in SM scope
    const overrideDto = ReassignLeadDto.parse({ ...dto, override_capacity: true });

    await expect(h.service.reassign(LEAD, overrideDto, bmUser, smScope)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(h.leads.assignOwner).not.toHaveBeenCalled();
  });

  it('new_owner_id inactive/unknown → FORBIDDEN (no existence leak)', async () => {
    const h = makeHarness();
    h.repo.findActiveUser.mockResolvedValue(undefined);
    await expect(h.service.reassign(LEAD, dto, bmUser, bmScope)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('new_owner_id outside the caller scope (other branch) → FORBIDDEN', async () => {
    const h = makeHarness();
    h.repo.findActiveUser.mockResolvedValue({ user_id: dto.new_owner_id, branch_id: 'branch-OTHER', team_id: null });
    await expect(h.service.reassign(LEAD, dto, bmUser, bmScope)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('T22 analogue: target RM at the matching rule capacity and no override → CONFLICT', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx());
    h.repo.findActiveUser.mockResolvedValue({ user_id: dto.new_owner_id, branch_id: 'branch-1', team_id: 'team-9' });
    h.repo.findActiveRules.mockResolvedValue([rule({ capacity_limit: 2 })]);
    h.repo.activeLeadCounts.mockResolvedValue(new Map([[dto.new_owner_id, 2]]));

    await expect(h.service.reassign(LEAD, dto, bmUser, bmScope)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(h.leads.assignOwner).not.toHaveBeenCalled();
  });

  it('T23 analogue: BM (scope B) override_capacity=true bypasses the capacity gate; audit detail records it', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx());
    h.repo.findActiveUser.mockResolvedValue({ user_id: dto.new_owner_id, branch_id: 'branch-1', team_id: 'team-9' });
    h.repo.findActiveRules.mockResolvedValue([rule({ capacity_limit: 2 })]);
    h.repo.activeLeadCounts.mockResolvedValue(new Map([[dto.new_owner_id, 2]]));
    const overrideDto = ReassignLeadDto.parse({ ...dto, override_capacity: true });

    const result = await h.service.reassign(LEAD, overrideDto, bmUser, bmScope);

    expect(result.owner_id).toBe(dto.new_owner_id);
    expect(h.repo.activeLeadCounts).not.toHaveBeenCalled(); // gate skipped on override
    expect(h.leads.assignOwner).toHaveBeenCalledWith(
      LEAD,
      expect.objectContaining({ detail: { override_capacity: true } }),
      TX,
    );
  });

  it('no matching rule (or no capacity_limit) → no capacity constraint', async () => {
    const h = makeHarness();
    h.repo.findLeadAllocationContext.mockResolvedValue(leadCtx());
    h.repo.findActiveUser.mockResolvedValue({ user_id: dto.new_owner_id, branch_id: 'branch-1', team_id: null });
    h.repo.findActiveRules.mockResolvedValue([rule({ criteria: { product_code: 'TRACTOR' }, capacity_limit: 1 })]);

    const result = await h.service.reassign(LEAD, dto, bmUser, bmScope);

    expect(result.owner_id).toBe(dto.new_owner_id);
    expect(h.repo.activeLeadCounts).not.toHaveBeenCalled();
  });
});

// ── allocation_rules admin (T28/T31/T32/T33 analogues) ────────────────────────

describe('AllocationService rules admin', () => {
  const head: AuthUser = { userId: 'head-1', orgId: ORG, role: 'HEAD', scope: DataScope.A, jti: 'j2' } as AuthUser;

  it('T28 analogue: listRules returns wire views with pagination meta (LIMIT-bounded repo)', async () => {
    const h = makeHarness();
    h.repo.listRules.mockResolvedValue([rule(), rule({ allocation_rule_id: 'rule-2', priority_order: 2 })]);
    h.repo.countRules.mockResolvedValue(12);

    const result = await h.service.listRules({ page: 1, limit: 25 }, head);

    expect(h.repo.listRules).toHaveBeenCalledWith(ORG, 1, 25);
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 12 });
    expect(result.data).toHaveLength(2);
    // Response shape: exactly the contract fields — no governance/PII columns (T28 shape check).
    expect(Object.keys(result.data[0] as object).sort()).toEqual([
      'allocation_rule_id',
      'capacity_limit',
      'criteria',
      'is_active',
      'method',
      'name',
      'priority_order',
      'target',
    ]);
  });

  it('T31 analogue: createRule persists via the owner repository and returns the created view', async () => {
    const h = makeHarness();
    h.repo.insertRule.mockResolvedValue(rule({ allocation_rule_id: 'rule-new', priority_order: 5 }));
    const dto = CreateAllocationRuleDto.parse({
      name: 'Branch Routing — Pune West',
      priority_order: 5,
      method: 'branch',
      criteria: { branch_id: 'branch-1', product_code: 'CAR' },
      target: { team_ids: ['team-1', 'team-2'] },
      capacity_limit: 40,
    });

    const view = await h.service.createRule(dto, head);

    expect(h.repo.insertRule).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ name: dto.name, priority_order: 5, method: 'branch', is_active: true }),
      'head-1',
    );
    expect(view.allocation_rule_id).toBe('rule-new');
  });

  it('T32 analogue: duplicate priority_order (pg 23505) maps to CONFLICT', async () => {
    const h = makeHarness();
    h.repo.insertRule.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const dto = CreateAllocationRuleDto.parse({
      name: 'Clash',
      priority_order: 1,
      method: 'round_robin',
      criteria: { product_code: 'CV' },
      target: { team_ids: ['team-1'] },
    });

    await expect(h.service.createRule(dto, head)).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('re-throws non-unique-violation insert errors untouched (no swallowed errors)', async () => {
    const h = makeHarness();
    h.repo.insertRule.mockRejectedValue(new Error('connection reset'));
    const dto = CreateAllocationRuleDto.parse({
      name: 'X',
      priority_order: 9,
      method: 'round_robin',
      criteria: { product_code: 'CV' },
      target: { team_ids: ['team-1'] },
    });
    await expect(h.service.createRule(dto, head)).rejects.toThrow('connection reset');
  });
});

// ── DTO validation (T12–T14, T33 analogues) ───────────────────────────────────

describe('ReassignLeadDto (T12–T14)', () => {
  const valid = {
    new_owner_id: 'c0000000-0000-0000-0000-00000000000c',
    reason: 'Customer requested language-match RM',
  };

  it('T12: missing reason → issue on field "reason"', () => {
    const r = ReassignLeadDto.safeParse({ new_owner_id: valid.new_owner_id });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['reason']);
  });

  it('T13: reason shorter than 5 chars → issue on field "reason"', () => {
    const r = ReassignLeadDto.safeParse({ ...valid, reason: 'abcd' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['reason']);
  });

  it('T14: new_owner_id not a UUID → issue on field "new_owner_id"', () => {
    const r = ReassignLeadDto.safeParse({ ...valid, new_owner_id: 'not-a-uuid' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['new_owner_id']);
  });

  it('defaults override_capacity to false and rejects non-boolean values', () => {
    expect(ReassignLeadDto.parse(valid).override_capacity).toBe(false);
    const r = ReassignLeadDto.safeParse({ ...valid, override_capacity: 'yes' });
    expect(r.success).toBe(false);
  });
});

describe('CreateAllocationRuleDto (T33)', () => {
  const valid = {
    name: 'CV High-Priority Partner Rule',
    priority_order: 1,
    method: 'partner',
    criteria: { product_code: 'CV', source: 'DSA', priority: 'high' },
    target: { partner_id: 'd0000000-0000-0000-0000-00000000000d' },
    capacity_limit: 30,
    is_active: true,
  };

  it('accepts a valid rule and defaults is_active to true when omitted', () => {
    const { is_active: _ignored, ...rest } = valid;
    const parsed = CreateAllocationRuleDto.parse(rest);
    expect(parsed.is_active).toBe(true);
    expect(parsed.method).toBe('partner');
  });

  it('T33: method outside the allocation_method enum → VALIDATION issue with the enum message', () => {
    const r = CreateAllocationRuleDto.safeParse({ ...valid, method: 'lottery' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        'method must be one of: round_robin, capacity, specialist, branch, partner, escalation',
      );
    }
  });

  it('rejects an empty criteria object', () => {
    const r = CreateAllocationRuleDto.safeParse({ ...valid, criteria: {} });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join('.') === 'criteria')).toBe(true);
  });

  it('rejects a target with neither team_ids nor partner_id', () => {
    const r = CreateAllocationRuleDto.safeParse({ ...valid, target: { region: 'west' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('target must specify team_ids array or partner_id');
    }
  });

  it('rejects priority_order < 1 and a capacity_limit outside 1..500', () => {
    expect(CreateAllocationRuleDto.safeParse({ ...valid, priority_order: 0 }).success).toBe(false);
    expect(CreateAllocationRuleDto.safeParse({ ...valid, capacity_limit: 0 }).success).toBe(false);
    expect(CreateAllocationRuleDto.safeParse({ ...valid, capacity_limit: 501 }).success).toBe(false);
  });
});

// ── pure evaluation helpers ───────────────────────────────────────────────────

describe('criteriaMatches', () => {
  const lead = leadCtx();

  it('matches when ALL criteria keys are satisfied', () => {
    expect(
      criteriaMatches(
        { product_code: 'CV', source: 'DSA', partner_id: 'partner-9', priority: 'normal', language: 'Hindi', is_hot: false, branch_id: 'branch-1' },
        lead,
      ),
    ).toBe(true);
  });

  it('fails when any single criterion mismatches', () => {
    expect(criteriaMatches({ product_code: 'CV', source: 'Website' }, lead)).toBe(false);
    expect(criteriaMatches({ is_hot: true }, lead)).toBe(false);
    expect(criteriaMatches({ branch_id: 'branch-OTHER' }, lead)).toBe(false);
  });

  it('treats an unknown criteria key as unsatisfiable (deny-by-default)', () => {
    expect(criteriaMatches({ pin_code: '411001' }, lead)).toBe(false);
  });
});

describe('pickCandidate', () => {
  it('orders by load, then created_at, then user_id (total deterministic order)', () => {
    const a = candidate('rm-a', { created_at: new Date('2026-01-02T00:00:00Z') });
    const b = candidate('rm-b', { created_at: new Date('2026-01-01T00:00:00Z') });
    const c = candidate('rm-c', { created_at: new Date('2026-01-01T00:00:00Z') });

    // Lowest load wins outright.
    expect(pickCandidate([a, b], new Map([['rm-a', 1], ['rm-b', 5]])).user_id).toBe('rm-a');
    // Equal load → earlier created_at.
    expect(pickCandidate([a, b], new Map([['rm-a', 2], ['rm-b', 2]])).user_id).toBe('rm-b');
    // Equal load + created_at → lowest user_id.
    expect(pickCandidate([c, b], new Map()).user_id).toBe('rm-b');
  });
});
