import { Capability, DataScope, RoleCode, UserStatus } from '@lms/shared';

import type {
  ActiveBreakGlassGrant,
  ActorEntitlement,
  RolePermissionEntry,
} from './abac.types';
import type { EntitlementCacheService } from './entitlement-cache.service';
import { EntitlementService } from './entitlement.service';

const ORG = 'org-1';

/** Build a role permission map from a {capability: max_scope} spec. */
function perms(spec: Partial<Record<Capability, DataScope>>): Map<Capability, RolePermissionEntry> {
  const map = new Map<Capability, RolePermissionEntry>();
  for (const [capability, maxScope] of Object.entries(spec) as Array<[Capability, DataScope]>) {
    map.set(capability, { capability, maxScope, conditions: null });
  }
  return map;
}

function actor(overrides: Partial<ActorEntitlement> & Pick<ActorEntitlement, 'userId' | 'roleCode'>): ActorEntitlement {
  return {
    orgId: ORG,
    status: UserStatus.ACTIVE,
    roleId: `role-${overrides.roleCode}`,
    defaultScope: DataScope.O,
    branchId: null,
    teamId: null,
    regionId: null,
    partnerId: null,
    permissions: new Map(),
    ...overrides,
  };
}

/**
 * A fake {@link EntitlementCacheService} returning a single pre-built actor plus
 * configurable team/region/break-glass fixtures. Only the methods the evaluator
 * calls are implemented.
 */
function fakeCache(opts: {
  actor?: ActorEntitlement;
  teamMembers?: string[];
  regionBranches?: string[];
  breakGlass?: ActiveBreakGlassGrant;
}): EntitlementCacheService {
  return {
    loadActorEntitlement: jest.fn(async () => opts.actor),
    loadTeamMemberIds: jest.fn(async () => opts.teamMembers ?? []),
    loadRegionBranchIds: jest.fn(async () => opts.regionBranches ?? []),
    loadActiveBreakGlass: jest.fn(async () => opts.breakGlass),
  } as unknown as EntitlementCacheService;
}

const future = (): Date => new Date(Date.now() + 60 * 60 * 1000);

describe('EntitlementService.can', () => {
  // A-01
  it('returns granted=true with scope=O when RM has view_lead and resource owned by RM', async () => {
    const rm = actor({
      userId: 'rm-1',
      roleCode: RoleCode.RM,
      branchId: 'B1',
      teamId: 'T1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.O }),
    });
    const svc = new EntitlementService(fakeCache({ actor: rm }));

    const res = await svc.can({ userId: 'rm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-1',
    });

    expect(res).toEqual({
      granted: true,
      scope: DataScope.O,
      scopePredicate: { type: 'own', userId: 'rm-1' },
    });
  });

  // A-02
  it('returns granted=false (NO_CAPABILITY) when user role has no role_permission for capability', async () => {
    // A non-ADMIN role with an empty permission map (so the NO_CAPABILITY path, not
    // the ADMIN break-glass path, is exercised).
    const head = actor({ userId: 'h-1', roleCode: RoleCode.HEAD, permissions: perms({}) });
    const svc = new EntitlementService(fakeCache({ actor: head }));

    const res = await svc.can({ userId: 'h-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'someone',
    });

    expect(res).toEqual({ granted: false, reason: 'NO_CAPABILITY' });
  });

  // A-03
  it('returns granted=false (OUT_OF_SCOPE) when RM requests view_lead on a lead owned by another RM', async () => {
    const rm = actor({
      userId: 'rm-1',
      roleCode: RoleCode.RM,
      branchId: 'B1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.O }),
    });
    const svc = new EntitlementService(fakeCache({ actor: rm }));

    const res = await svc.can({ userId: 'rm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-2',
    });

    expect(res).toEqual({ granted: false, reason: 'OUT_OF_SCOPE' });
  });

  // A-04
  it('returns granted=false (SUSPENDED_USER) when user.status = inactive', async () => {
    const rm = actor({
      userId: 'rm-1',
      roleCode: RoleCode.RM,
      status: UserStatus.INACTIVE,
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.O }),
    });
    const svc = new EntitlementService(fakeCache({ actor: rm }));

    const res = await svc.can({ userId: 'rm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-1',
    });

    expect(res).toEqual({ granted: false, reason: 'SUSPENDED_USER' });
  });

  // A-05
  it('returns granted=true with scope=B when BM requests view_lead on lead in own branch', async () => {
    const bm = actor({
      userId: 'bm-1',
      roleCode: RoleCode.BM,
      branchId: 'B1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.B }),
    });
    const svc = new EntitlementService(fakeCache({ actor: bm }));

    const res = await svc.can({ userId: 'bm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      branchId: 'B1',
    });

    expect(res).toEqual({
      granted: true,
      scope: DataScope.B,
      scopePredicate: { type: 'branch', branchId: 'B1' },
    });
  });

  // A-06
  it('returns granted=false (OUT_OF_SCOPE) when BM requests view_lead on lead in different branch', async () => {
    const bm = actor({
      userId: 'bm-1',
      roleCode: RoleCode.BM,
      branchId: 'B1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.B }),
    });
    const svc = new EntitlementService(fakeCache({ actor: bm }));

    const res = await svc.can({ userId: 'bm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      branchId: 'B2',
    });

    expect(res).toEqual({ granted: false, reason: 'OUT_OF_SCOPE' });
  });

  // A-07
  it('returns granted=true with scope=T when SM requests view_lead on lead owned by team member', async () => {
    const sm = actor({
      userId: 'sm-1',
      roleCode: RoleCode.SM,
      teamId: 'T1',
      branchId: 'B1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.T }),
    });
    const svc = new EntitlementService(fakeCache({ actor: sm, teamMembers: ['rm-a', 'rm-b'] }));

    const res = await svc.can({ userId: 'sm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-a',
    });

    expect(res).toEqual({
      granted: true,
      scope: DataScope.T,
      scopePredicate: { type: 'team', userIds: ['rm-a', 'rm-b'] },
    });
  });

  // A-08
  it('returns granted=false (OUT_OF_SCOPE) when SM requests view_lead on lead outside their team', async () => {
    const sm = actor({
      userId: 'sm-1',
      roleCode: RoleCode.SM,
      teamId: 'T1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.T }),
    });
    const svc = new EntitlementService(fakeCache({ actor: sm, teamMembers: ['rm-a', 'rm-b'] }));

    const res = await svc.can({ userId: 'sm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-z',
    });

    expect(res).toEqual({ granted: false, reason: 'OUT_OF_SCOPE' });
  });

  // A-09
  it('returns granted=false (ADMIN_LEAD_BLOCKED) when ADMIN requests view_lead without break-glass', async () => {
    const admin = actor({ userId: 'a-1', roleCode: RoleCode.ADMIN, permissions: perms({}) });
    const svc = new EntitlementService(fakeCache({ actor: admin /* no breakGlass */ }));

    const res = await svc.can({ userId: 'a-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-1',
    });

    expect(res).toEqual({ granted: false, reason: 'ADMIN_LEAD_BLOCKED' });
  });

  // A-10
  it('returns granted=true when ADMIN has an active break-glass grant in scope', async () => {
    const admin = actor({ userId: 'a-1', roleCode: RoleCode.ADMIN, permissions: perms({}) });
    const grant: ActiveBreakGlassGrant = {
      grantId: 'g-1',
      scopeType: 'all',
      scopeRef: null,
      validUntil: future(),
    };
    const svc = new EntitlementService(fakeCache({ actor: admin, breakGlass: grant }));

    const res = await svc.can({ userId: 'a-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-1',
    });

    expect(res).toEqual({
      granted: true,
      scope: DataScope.A,
      scopePredicate: { type: 'all', orgId: ORG },
    });
  });

  // A-11
  it('returns granted=false (PARTNER_CROSS_ACCESS) when PARTNER requests view_lead on another partners lead', async () => {
    const partner = actor({
      userId: 'p-user',
      roleCode: RoleCode.PARTNER,
      partnerId: 'P1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.P }),
    });
    const svc = new EntitlementService(fakeCache({ actor: partner }));

    const res = await svc.can({ userId: 'p-user', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      partnerId: 'P2',
    });

    expect(res).toEqual({ granted: false, reason: 'PARTNER_CROSS_ACCESS' });
  });

  // A-12
  it('returns granted=true with scope=P when PARTNER requests view_lead on own submitted lead', async () => {
    const partner = actor({
      userId: 'p-user',
      roleCode: RoleCode.PARTNER,
      partnerId: 'P1',
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.P }),
    });
    const svc = new EntitlementService(fakeCache({ actor: partner }));

    const res = await svc.can({ userId: 'p-user', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      partnerId: 'P1',
    });

    expect(res).toEqual({
      granted: true,
      scope: DataScope.P,
      scopePredicate: { type: 'partner', partnerId: 'P1' },
    });
  });

  // A-13
  it('returns granted=true with scope=M (masked) for DPO view_lead', async () => {
    const dpo = actor({
      userId: 'dpo-1',
      roleCode: RoleCode.DPO,
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.M }),
    });
    const svc = new EntitlementService(fakeCache({ actor: dpo }));

    const res = await svc.can({ userId: 'dpo-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-1',
    });

    expect(res).toEqual({
      granted: true,
      scope: DataScope.M,
      scopePredicate: { type: 'masked', orgId: ORG },
    });
  });

  // A-15 (A-14 is a guard-level concern — see abac.guard.spec.ts)
  it('returns granted=false (SUSPENDED_USER) for user with locked status', async () => {
    const rm = actor({
      userId: 'rm-1',
      roleCode: RoleCode.RM,
      status: UserStatus.LOCKED,
      permissions: perms({ [Capability.VIEW_LEAD]: DataScope.O }),
    });
    const svc = new EntitlementService(fakeCache({ actor: rm }));

    const res = await svc.can({ userId: 'rm-1', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
      ownerId: 'rm-1',
    });

    expect(res).toEqual({ granted: false, reason: 'SUSPENDED_USER' });
  });

  it('treats an unknown/missing actor record as a hard deny (SUSPENDED_USER)', async () => {
    const svc = new EntitlementService(fakeCache({ actor: undefined }));

    const res = await svc.can({ userId: 'ghost', orgId: ORG }, Capability.VIEW_LEAD, {
      resourceType: 'leads',
    });

    expect(res).toEqual({ granted: false, reason: 'SUSPENDED_USER' });
  });

  it('does not block ADMIN on its legitimate org-wide capabilities (export/consent_ledger/audit_trail)', async () => {
    // These are administrative/compliance capabilities ADMIN holds (scope A) — they
    // are NOT lead-record content, so the break-glass gate must not fire.
    const admin = actor({
      userId: 'a-1',
      roleCode: RoleCode.ADMIN,
      permissions: perms({
        [Capability.EXPORT]: DataScope.A,
        [Capability.CONSENT_LEDGER]: DataScope.A,
        [Capability.AUDIT_TRAIL]: DataScope.A,
      }),
    });
    const svc = new EntitlementService(fakeCache({ actor: admin /* no break-glass */ }));

    for (const cap of [Capability.EXPORT, Capability.CONSENT_LEDGER, Capability.AUDIT_TRAIL]) {
      const res = await svc.can({ userId: 'a-1', orgId: ORG }, cap, { resourceType: 'export_jobs' });
      expect(res).toEqual({ granted: true, scope: DataScope.A, scopePredicate: { type: 'all', orgId: ORG } });
    }
  });

  it('grants ADMIN a branch-scoped lead view when an active branch break-glass matches the resource branch', async () => {
    const admin = actor({ userId: 'a-1', roleCode: RoleCode.ADMIN, permissions: perms({}) });
    const grant: ActiveBreakGlassGrant = {
      grantId: 'g-2',
      scopeType: 'branch',
      scopeRef: 'B7',
      validUntil: future(),
    };
    const svc = new EntitlementService(fakeCache({ actor: admin, breakGlass: grant }));

    const ok = await svc.can({ userId: 'a-1', orgId: ORG }, Capability.VIEW_LEAD, { resourceType: 'leads', branchId: 'B7' });
    expect(ok).toEqual({ granted: true, scope: DataScope.B, scopePredicate: { type: 'branch', branchId: 'B7' } });

    const denied = await svc.can({ userId: 'a-1', orgId: ORG }, Capability.VIEW_LEAD, { resourceType: 'leads', branchId: 'B8' });
    expect(denied).toEqual({ granted: false, reason: 'OUT_OF_SCOPE' });
  });

  it('grants a list/create with no resource owner (scope-availability only) for scope O', async () => {
    // POST /leads or GET /leads: no pre-known ownerId; scope O still grants and the
    // own-predicate filters the rows downstream.
    const rm = actor({
      userId: 'rm-1',
      roleCode: RoleCode.RM,
      branchId: 'B1',
      permissions: perms({ [Capability.CREATE_LEAD]: DataScope.O }),
    });
    const svc = new EntitlementService(fakeCache({ actor: rm }));

    const res = await svc.can({ userId: 'rm-1', orgId: ORG }, Capability.CREATE_LEAD, {
      resourceType: 'leads',
    });

    expect(res).toEqual({
      granted: true,
      scope: DataScope.O,
      scopePredicate: { type: 'own', userId: 'rm-1' },
    });
  });
});
