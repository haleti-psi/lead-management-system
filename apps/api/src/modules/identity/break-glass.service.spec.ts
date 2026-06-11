import { AuditAction, ERROR_CODES, GrantStatus } from '@lms/shared';

import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { FakeAudit } from './auth.test-helpers';
import type { BreakGlassRequestDto } from './break-glass.dto';
import { BreakGlassService, type BreakGlassActor } from './break-glass.service';
import {
  BreakGlassRepository,
  type BreakGlassGrantRow,
  type UserRoleRow,
} from './break-glass.repository';

/**
 * FR-003 unit tests for {@link BreakGlassService}: the four-eyes request guard
 * (T03), the happy-path create (T01 service slice) and approve (T02 service
 * slice), the approve-side guards (wrong approver T04, self-approve T05,
 * not-found T13, re-approve CONFLICT T14), revoke (T17), and transaction
 * rollback on an audit/DB failure (T22, T23). Collaborators are typed fakes; the
 * UnitOfWork mock runs the callback with a sentinel tx so the atomic grouping is
 * asserted without a DB.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const REQUESTER = 'admin-requester';
const GRANTEE = 'grantee-user';
const APPROVER = 'approver-user';
const LEAD = '33333333-3333-3333-3333-333333333333';

const ACTOR: BreakGlassActor = { userId: REQUESTER, orgId: ORG };
const APPROVER_ACTOR: BreakGlassActor = { userId: APPROVER, orgId: ORG };

function dto(overrides: Partial<BreakGlassRequestDto> = {}): BreakGlassRequestDto {
  return {
    granteeId: GRANTEE,
    approverId: APPROVER,
    scopeType: 'lead',
    scopeRef: LEAD,
    reason: 'Incident #4471 — data review',
    validFrom: '2026-06-09T09:00:00.000Z',
    validUntil: '2026-06-09T11:00:00.000Z',
    ...overrides,
  };
}

function grantRow(overrides: Partial<BreakGlassGrantRow> = {}): BreakGlassGrantRow {
  return {
    grant_id: 'grant-1',
    org_id: ORG,
    grantee_id: GRANTEE,
    approver_id: APPROVER,
    scope_type: 'lead',
    scope_ref: LEAD,
    reason: 'Incident #4471 — data review',
    status: GrantStatus.PENDING,
    valid_from: new Date('2026-06-09T09:00:00.000Z'),
    valid_until: new Date('2026-06-09T11:00:00.000Z'),
    created_at: new Date('2026-06-09T08:55:00.000Z'),
    updated_at: new Date('2026-06-09T08:55:00.000Z'),
    ...overrides,
  };
}

/** A typed, in-memory BreakGlassRepository fake with per-method jest spies. */
class FakeRepo {
  insert = jest.fn(async (): Promise<BreakGlassGrantRow> => grantRow());
  findById = jest.fn(async (): Promise<BreakGlassGrantRow | undefined> => undefined);
  setActive = jest.fn(
    async (_id: string, _org: string, approverId: string): Promise<BreakGlassGrantRow | undefined> =>
      grantRow({ status: GrantStatus.ACTIVE, approver_id: approverId }),
  );
  revoke = jest.fn(async (): Promise<BreakGlassGrantRow | undefined> => grantRow({ status: GrantStatus.REVOKED }));
  expireDue = jest.fn(async (): Promise<string[]> => []);
  findUserRole = jest.fn(async (userId: string): Promise<UserRoleRow | undefined> => {
    if (userId === GRANTEE) return { user_id: GRANTEE, role_code: 'RM' };
    if (userId === APPROVER) return { user_id: APPROVER, role_code: 'DPO' };
    return undefined;
  });
  leadExists = jest.fn(async (): Promise<boolean> => true);
  branchExists = jest.fn(async (): Promise<boolean> => true);

  asRepo(): BreakGlassRepository {
    return this as unknown as BreakGlassRepository;
  }
}

/** UnitOfWork mock that invokes the callback with a sentinel transaction. */
function fakeUow(): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true })),
  } as unknown as UnitOfWork;
}

interface Harness {
  service: BreakGlassService;
  repo: FakeRepo;
  audit: FakeAudit;
  uow: UnitOfWork;
}

function harness(): Harness {
  const repo = new FakeRepo();
  const audit = new FakeAudit();
  const uow = fakeUow();
  const service = new BreakGlassService(repo.asRepo(), audit.asAppender(), uow);
  return { service, repo, audit, uow };
}

async function capture(p: Promise<unknown>): Promise<DomainException> {
  try {
    await p;
    throw new Error('expected the call to reject');
  } catch (err) {
    expect(err).toBeInstanceOf(DomainException);
    return err as DomainException;
  }
}

describe('BreakGlassService.request', () => {
  it('inserts a pending grant and appends a grant_requested audit row (T01)', async () => {
    const { service, repo, audit } = harness();

    const res = await service.request(ACTOR, dto());

    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(GrantStatus.PENDING);
    expect(res.granteeId).toBe(GRANTEE);
    expect(res.approverId).toBe(APPROVER);
    const audits = audit.ofAction(AuditAction.BREAK_GLASS_ACCESS);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toMatchObject({ event: 'grant_requested', scope_type: 'lead' });
    // entity is the grant, never the lead — and no PII beyond the reason text.
    expect(audits[0]?.entity_type).toBe('break_glass_grants');
  });

  it('raises FORBIDDEN when approver equals grantee (T03)', async () => {
    const { service, repo } = harness();

    const err = await capture(service.request(ACTOR, dto({ approverId: GRANTEE })));

    expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('raises NOT_FOUND when the grantee does not exist', async () => {
    const { service, repo } = harness();
    repo.findUserRole.mockResolvedValueOnce(undefined); // grantee lookup

    const err = await capture(service.request(ACTOR, dto()));

    expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('raises FORBIDDEN when the nominated approver lacks break_glass capability', async () => {
    const { service, repo } = harness();
    repo.findUserRole.mockImplementation(async (userId: string) =>
      userId === GRANTEE
        ? { user_id: GRANTEE, role_code: 'RM' }
        : { user_id: APPROVER, role_code: 'RM' }, // approver is an RM → not capable
    );

    const err = await capture(service.request(ACTOR, dto()));

    expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(err.detail).toMatchObject({ reason: 'APPROVER_NOT_CAPABLE' });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('raises NOT_FOUND when a lead-scoped grant references a missing lead', async () => {
    const { service, repo } = harness();
    repo.leadExists.mockResolvedValueOnce(false);

    const err = await capture(service.request(ACTOR, dto({ scopeType: 'lead', scopeRef: LEAD })));

    expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('rolls back (no audit committed) when the insert throws mid-transaction (T22)', async () => {
    const { service, repo, audit } = harness();
    repo.insert.mockRejectedValueOnce(new Error('db down'));

    await expect(service.request(ACTOR, dto())).rejects.toThrow('db down');
    expect(audit.entries).toHaveLength(0);
  });
});

describe('BreakGlassService.approve', () => {
  it('activates the grant and audits grant_approved (T02)', async () => {
    const { service, repo, audit } = harness();
    repo.findById.mockResolvedValueOnce(grantRow({ status: GrantStatus.PENDING }));

    const res = await service.approve(APPROVER_ACTOR, 'grant-1');

    expect(res.status).toBe(GrantStatus.ACTIVE);
    expect(res.approverId).toBe(APPROVER);
    expect(repo.setActive).toHaveBeenCalledWith('grant-1', ORG, APPROVER, { __tx: true });
    expect(audit.ofAction(AuditAction.BREAK_GLASS_ACCESS)[0]?.detail).toMatchObject({ event: 'grant_approved' });
  });

  it('raises NOT_FOUND when the grant does not exist (T13)', async () => {
    const { service } = harness();

    const err = await capture(service.approve(APPROVER_ACTOR, 'missing'));

    expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('raises FORBIDDEN when the caller is not the nominated approver (T04)', async () => {
    const { service, repo } = harness();
    repo.findById.mockResolvedValueOnce(grantRow({ approver_id: 'someone-else' }));

    const err = await capture(service.approve(APPROVER_ACTOR, 'grant-1'));

    expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(repo.setActive).not.toHaveBeenCalled();
  });

  it('raises FORBIDDEN when the approver is also the grantee (self-approval, T05)', async () => {
    const { service, repo } = harness();
    // A grant whose grantee and approver are the same caller (defence-in-depth).
    repo.findById.mockResolvedValueOnce(grantRow({ grantee_id: APPROVER, approver_id: APPROVER }));

    const err = await capture(service.approve(APPROVER_ACTOR, 'grant-1'));

    expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(err.detail).toMatchObject({ reason: 'FOUR_EYES_REQUIRED' });
    expect(repo.setActive).not.toHaveBeenCalled();
  });

  it('raises CONFLICT when the grant is already active (re-approve, T14)', async () => {
    const { service, repo } = harness();
    repo.findById.mockResolvedValueOnce(grantRow({ status: GrantStatus.ACTIVE }));

    const err = await capture(service.approve(APPROVER_ACTOR, 'grant-1'));

    expect(err.code).toBe(ERROR_CODES.CONFLICT);
    expect(repo.setActive).not.toHaveBeenCalled();
  });

  it('raises CONFLICT when the guarded UPDATE matches no row (lost race)', async () => {
    const { service, repo } = harness();
    repo.findById.mockResolvedValueOnce(grantRow({ status: GrantStatus.PENDING }));
    repo.setActive.mockResolvedValueOnce(undefined);

    const err = await capture(service.approve(APPROVER_ACTOR, 'grant-1'));

    expect(err.code).toBe(ERROR_CODES.CONFLICT);
  });

  it('rolls back (no audit committed) when the UPDATE throws mid-transaction (T23)', async () => {
    const { service, repo, audit } = harness();
    repo.findById.mockResolvedValueOnce(grantRow({ status: GrantStatus.PENDING }));
    repo.setActive.mockRejectedValueOnce(new Error('update failed'));

    await expect(service.approve(APPROVER_ACTOR, 'grant-1')).rejects.toThrow('update failed');
    expect(audit.entries).toHaveLength(0);
  });
});

describe('BreakGlassService.revoke', () => {
  it('revokes an active grant and audits grant_revoked (T17)', async () => {
    const { service, repo, audit } = harness();
    repo.findById.mockResolvedValueOnce(grantRow({ status: GrantStatus.ACTIVE }));

    const res = await service.revoke(ACTOR, 'grant-1');

    expect(res.status).toBe(GrantStatus.REVOKED);
    expect(repo.revoke).toHaveBeenCalledWith('grant-1', ORG, REQUESTER, { __tx: true });
    expect(audit.ofAction(AuditAction.BREAK_GLASS_ACCESS)[0]?.detail).toMatchObject({ event: 'grant_revoked' });
  });

  it('raises NOT_FOUND when the grant does not exist', async () => {
    const { service } = harness();

    const err = await capture(service.revoke(ACTOR, 'missing'));

    expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('raises CONFLICT when the grant is already terminal (expired/revoked)', async () => {
    const { service, repo } = harness();
    repo.findById.mockResolvedValueOnce(grantRow({ status: GrantStatus.EXPIRED }));

    const err = await capture(service.revoke(ACTOR, 'grant-1'));

    expect(err.code).toBe(ERROR_CODES.CONFLICT);
    expect(repo.revoke).not.toHaveBeenCalled();
  });
});
