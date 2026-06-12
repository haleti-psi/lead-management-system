import { AuditAction } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import type { LeadService } from '../capture/lead.service';
import { BulkActionService } from './bulk-action.service';
import type { LeadListRepository, ScopedLeadRef, WorkspaceUserRef } from './lead-list.repository';
import type { WorkspaceScopeContext } from './lead-list.service';
import { BulkActionDto } from './dto/bulk-action.dto';

/**
 * FR-050 — bulk-action gate, service-level analogues of TC-21 (no capability →
 * the gate never dispatches; here: deny-by-default scopes), TC-22 (BM dispatch
 * via LeadService.bulkReassign + EXACTLY ONE audit intent), TC-23
 * (out-of-scope ids stripped before dispatch and reported skipped), plus the
 * target-owner scope check (FR-030 parity) and the ineligible (terminal-stage)
 * status. FR-050 itself never writes `leads` — every mutation goes through the
 * mocked LeadService.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const TX = { __tx: true } as unknown as DbTransaction;
const bm: AuthUser = { userId: 'bm-1', orgId: ORG, role: 'BM', scope: 'B', jti: 'j1' };

const id = (n: number) => `f6a7c8d9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(99);

const branchCtx: WorkspaceScopeContext = {
  effectiveScope: 'B',
  predicate: { type: 'branch', branchId: 'branch-1' },
};

function dto(leadIds: string[], overrides: Partial<BulkActionDto> = {}): BulkActionDto {
  return BulkActionDto.parse({
    action: 'reassign',
    lead_ids: leadIds,
    reason: 'Load balancing',
    params: { owner_id: OWNER },
    ...overrides,
  });
}

interface Harness {
  service: BulkActionService;
  repo: { findLeadsInScope: jest.Mock; findActiveUser: jest.Mock };
  leads: { bulkReassign: jest.Mock };
  audit: { append: jest.Mock };
  uowRun: jest.Mock;
}

function makeHarness(
  inScope: ScopedLeadRef[],
  // `null` = no users row found (an explicit `undefined` would trigger the default).
  target: WorkspaceUserRef | null = { user_id: OWNER, branch_id: 'branch-1', team_id: null, region_id: null },
): Harness {
  const repo = {
    findLeadsInScope: jest.fn().mockResolvedValue(inScope),
    findActiveUser: jest.fn().mockResolvedValue(target ?? undefined),
  };
  const leads = {
    bulkReassign: jest.fn(async (ids: readonly string[]) => ids.length),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const uowRun = jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX));
  const service = new BulkActionService(
    repo as unknown as LeadListRepository,
    leads as unknown as LeadService,
    { run: uowRun } as unknown as UnitOfWork,
    audit as unknown as AuditAppender,
  );
  return { service, repo, leads, audit, uowRun };
}

describe('BulkActionService.execute', () => {
  it('TC-22: dispatches in-scope leads through LeadService.bulkReassign in ONE uow tx', async () => {
    const ids = [id(1), id(2), id(3)];
    const { service, repo, leads, uowRun } = makeHarness(
      ids.map((lead_id): ScopedLeadRef => ({ lead_id, stage: 'assigned' })),
    );
    const result = await service.execute(bm, dto(ids), branchCtx);

    expect(uowRun).toHaveBeenCalledTimes(1);
    expect(repo.findLeadsInScope).toHaveBeenCalledWith(ORG, branchCtx.predicate, ids, TX);
    expect(leads.bulkReassign).toHaveBeenCalledTimes(1);
    expect(leads.bulkReassign).toHaveBeenCalledWith(ids, OWNER, 'Load balancing', TX);
    expect(result).toEqual({
      action: 'reassign',
      requested: 3,
      succeeded: 3,
      items: ids.map((lead_id) => ({ lead_id, status: 'succeeded' })),
    });
  });

  it('TC-22: appends EXACTLY ONE audit intent for the bulk action, in the same tx', async () => {
    const ids = [id(1), id(2)];
    const { service, audit } = makeHarness(ids.map((lead_id): ScopedLeadRef => ({ lead_id, stage: 'assigned' })));
    await service.execute(bm, dto(ids), branchCtx);

    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.REASSIGN,
        entity_type: 'leads',
        entity_id: null,
        actor_id: bm.userId,
        org_id: ORG,
        detail: expect.objectContaining({
          sub_action: 'bulk_action',
          bulk_action: 'reassign',
          requested: 2,
          succeeded: 2,
          new_owner_id: OWNER,
        }),
      }),
      TX,
    );
  });

  it('TC-23: out-of-scope ids are stripped BEFORE dispatch and reported skipped', async () => {
    const inBranch = [id(1), id(2)];
    const crossBranch = id(3);
    const { service, leads, audit } = makeHarness(
      inBranch.map((lead_id): ScopedLeadRef => ({ lead_id, stage: 'assigned' })),
    );
    const result = await service.execute(bm, dto([...inBranch, crossBranch]), branchCtx);

    expect(leads.bulkReassign).toHaveBeenCalledWith(inBranch, OWNER, 'Load balancing', TX);
    expect(result.succeeded).toBe(2);
    expect(result.items).toEqual([
      { lead_id: id(1), status: 'succeeded' },
      { lead_id: id(2), status: 'succeeded' },
      { lead_id: crossBranch, status: 'skipped_out_of_scope' },
    ]);
    const detail = audit.append.mock.calls[0]?.[0]?.detail as Record<string, unknown>;
    expect(detail['skipped_out_of_scope']).toEqual([crossBranch]);
  });

  it('terminal-stage leads are excluded from dispatch and reported ineligible', async () => {
    const { service, leads } = makeHarness([
      { lead_id: id(1), stage: 'assigned' },
      { lead_id: id(2), stage: 'handed_off' },
      { lead_id: id(3), stage: 'rejected' },
    ]);
    const result = await service.execute(bm, dto([id(1), id(2), id(3)]), branchCtx);

    expect(leads.bulkReassign).toHaveBeenCalledWith([id(1)], OWNER, 'Load balancing', TX);
    expect(result.items).toEqual([
      { lead_id: id(1), status: 'succeeded' },
      { lead_id: id(2), status: 'skipped_ineligible' },
      { lead_id: id(3), status: 'skipped_ineligible' },
    ]);
  });

  it('TC-21 analogue: own/masked/missing scopes are denied before ANY dispatch', async () => {
    for (const ctx of [
      {},
      { effectiveScope: 'O', predicate: { type: 'own', userId: 'rm-1' } },
      { effectiveScope: 'M', predicate: { type: 'masked', orgId: ORG } },
    ] as WorkspaceScopeContext[]) {
      const { service, leads, audit, repo } = makeHarness([]);
      await expect(service.execute(bm, dto([id(1)]), ctx)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(repo.findLeadsInScope).not.toHaveBeenCalled();
      expect(leads.bulkReassign).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
    }
  });

  it('a target owner outside the caller scope is FORBIDDEN (no mutator invoked)', async () => {
    const { service, leads } = makeHarness(
      [{ lead_id: id(1), stage: 'assigned' }],
      { user_id: OWNER, branch_id: 'other-branch', team_id: null, region_id: null },
    );
    await expect(service.execute(bm, dto([id(1)]), branchCtx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(leads.bulkReassign).not.toHaveBeenCalled();
  });

  it('an unknown/inactive target owner is FORBIDDEN', async () => {
    const { service, leads } = makeHarness([{ lead_id: id(1), stage: 'assigned' }], null);
    await expect(service.execute(bm, dto([id(1)]), branchCtx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(leads.bulkReassign).not.toHaveBeenCalled();
  });

  it('SM (team scope) may only target a team member', async () => {
    const teamCtx: WorkspaceScopeContext = {
      effectiveScope: 'T',
      predicate: { type: 'team', userIds: ['rm-1', 'rm-2'] },
    };
    const sm: AuthUser = { userId: 'sm-1', orgId: ORG, role: 'SM', scope: 'T', jti: 'j9' };
    const { service, leads } = makeHarness(
      [{ lead_id: id(1), stage: 'assigned' }],
      { user_id: OWNER, branch_id: 'branch-1', team_id: 'team-1', region_id: null },
    );
    await expect(service.execute(sm, dto([id(1)]), teamCtx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(leads.bulkReassign).not.toHaveBeenCalled();
  });

  it('an entirely out-of-scope selection mutates nothing but still audits the intent', async () => {
    const { service, leads, audit } = makeHarness([]);
    const result = await service.execute(bm, dto([id(7)]), branchCtx);
    expect(leads.bulkReassign).toHaveBeenCalledWith([], OWNER, 'Load balancing', TX);
    expect(result.succeeded).toBe(0);
    expect(result.items).toEqual([{ lead_id: id(7), status: 'skipped_out_of_scope' }]);
    expect(audit.append).toHaveBeenCalledTimes(1);
  });
});
