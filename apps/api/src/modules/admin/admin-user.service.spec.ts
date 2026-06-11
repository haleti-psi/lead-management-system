import * as argon2 from 'argon2';

import { DataScope, UserStatus } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { isDomainException } from '../../core/http';
import { AdminUserService } from './admin-user.service';
import type { LeadReassignPort } from './ports/lead-reassign.port';
import { UserRepository, type UserListRow } from './user.repository';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

/**
 * FR-130 unit tests for {@link AdminUserService}: scope-A floor, create (argon2
 * hash + no password leak), duplicate CONFLICT, NOT_FOUND, the deactivate-with-
 * open-leads gate + reassign-via-port, transaction-rollback propagation, and the
 * E1 cache invalidation. Collaborators are mocked; the UnitOfWork mock runs the
 * callback with a sentinel tx so ordering/atomic grouping is asserted without a
 * database. (Testcontainers/SQL-invariant tier is DEFERRED.)
 */

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('$argon2id$hashed'),
  argon2id: 2,
}));
const argonHash = argon2.hash as jest.MockedFunction<typeof argon2.hash>;

const TX = { __tx: true } as const;
const ORG = '00000000-0000-0000-0000-000000000001';

const ADMIN: AuthUser = {
  userId: 'admin-1',
  orgId: ORG,
  role: 'ADMIN' as AuthUser['role'],
  scope: DataScope.A,
  jti: 'jti-1',
};

function userRow(overrides: Partial<UserListRow> = {}): UserListRow {
  return {
    user_id: 'user-1',
    username: 'jdoe',
    full_name: 'Jane Doe',
    email: 'jdoe@nbfc.com',
    mobile: '9876543210',
    role_id: 'role-bm',
    role_code: 'BM',
    branch_id: null,
    team_id: null,
    region_id: null,
    partner_id: null,
    product_skills: null,
    mfa_enabled: false,
    status: UserStatus.ACTIVE,
    reporting_manager_id: null,
    last_login_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}
function fakeCache(): EntitlementCacheService {
  return {
    invalidateUser: jest.fn().mockResolvedValue(undefined),
    invalidateRole: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntitlementCacheService;
}
function fakeReassign(): LeadReassignPort & { bulkReassign: jest.Mock } {
  return { bulkReassign: jest.fn().mockResolvedValue(3) };
}

type RepoMock = Record<keyof UserRepository, jest.Mock>;
function fakeRepo(overrides: Partial<RepoMock> = {}): UserRepository {
  const base: Partial<RepoMock> = {
    listUsers: jest.fn().mockResolvedValue([]),
    countUsers: jest.fn().mockResolvedValue(0),
    findById: jest.fn().mockResolvedValue(userRow()),
    findStatus: jest.fn().mockResolvedValue({ user_id: 'target-1', status: UserStatus.ACTIVE, role_id: 'role-rm' }),
    existsByUsernameOrEmail: jest.fn().mockResolvedValue(false),
    createUser: jest.fn().mockResolvedValue('user-1'),
    updateUser: jest.fn().mockResolvedValue(1),
    countOpenLeads: jest.fn().mockResolvedValue(0),
    roleExists: jest.fn().mockResolvedValue(true),
    regionExists: jest.fn().mockResolvedValue(true),
    partnerExists: jest.fn().mockResolvedValue(true),
    branchActive: jest.fn().mockResolvedValue(true),
    teamExists: jest.fn().mockResolvedValue(true),
  };
  return { ...base, ...overrides } as unknown as UserRepository;
}

function makeService(repo: UserRepository, deps: Partial<{
  uow: UnitOfWork;
  audit: AuditAppender;
  cache: EntitlementCacheService;
  reassign: LeadReassignPort;
}> = {}): AdminUserService {
  return new AdminUserService(
    repo,
    deps.uow ?? fakeUow(),
    deps.audit ?? fakeAudit(),
    deps.cache ?? fakeCache(),
    deps.reassign ?? fakeReassign(),
  );
}

const CREATE_DTO: CreateUserDto = {
  username: 'jdoe',
  email: 'jdoe@nbfc.com',
  full_name: 'Jane Doe',
  role_id: 'role-bm',
  mfa_enabled: false,
};

describe('AdminUserService.createUser', () => {
  it('hashes the temporary password with argon2 and never returns it (T-01/T-27)', async () => {
    const repo = fakeRepo();
    const service = makeService(repo);

    const result = await service.createUser(CREATE_DTO, ADMIN, DataScope.A);

    expect(argonHash).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('password_hash');
    expect(result.status).toBe('active');
    // The hash is passed to the repo, the cleartext never is.
    const createArg = (repo.createUser as jest.Mock).mock.calls[0][1];
    expect(createArg.password_hash).toBe('$argon2id$hashed');
  });

  it('appends a user_change audit row inside the transaction (T-01)', async () => {
    const audit = fakeAudit();
    const service = makeService(fakeRepo(), { audit });

    await service.createUser(CREATE_DTO, ADMIN, DataScope.A);

    const arg = (audit.append as jest.Mock).mock.calls[0][0];
    expect(arg.action).toBe('user_change');
    expect(arg.entity_type).toBe('user');
    expect(arg.actor_id).toBe('admin-1');
    expect((audit.append as jest.Mock).mock.calls[0][1]).toBe(TX);
  });

  it('throws CONFLICT when username/email already exists (T-07/T-08)', async () => {
    const repo = fakeRepo({ existsByUsernameOrEmail: jest.fn().mockResolvedValue(true) });
    const service = makeService(repo);

    await expect(service.createUser(CREATE_DTO, ADMIN, DataScope.A)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when role_id does not exist', async () => {
    const repo = fakeRepo({ roleExists: jest.fn().mockResolvedValue(false) });
    const service = makeService(repo);

    await expect(service.createUser(CREATE_DTO, ADMIN, DataScope.A)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a non scope-A caller with FORBIDDEN before any work (T-03 defence-in-depth)', async () => {
    const repo = fakeRepo();
    const uow = fakeUow();
    const service = makeService(repo, { uow });

    await expect(service.createUser(CREATE_DTO, ADMIN, DataScope.B)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(uow.run).not.toHaveBeenCalled();
  });
});

describe('AdminUserService.updateUser', () => {
  it('logs role_change when role_id changes, and invalidates the ABAC cache (T-09/E1)', async () => {
    const repo = fakeRepo({
      findById: jest
        .fn()
        .mockResolvedValueOnce(userRow({ role_id: 'role-bm' })) // existing
        .mockResolvedValue(userRow({ role_id: 'role-rm' })), // after
    });
    const audit = fakeAudit();
    const cache = fakeCache();
    const service = makeService(repo, { audit, cache });

    const dto: UpdateUserDto = { role_id: 'role-rm' };
    await service.updateUser('user-1', dto, ADMIN, DataScope.A);

    const action = (audit.append as jest.Mock).mock.calls[0][0].action;
    expect(action).toBe('role_change');
    expect(cache.invalidateUser).toHaveBeenCalledWith('user-1', ORG);
  });

  it('deactivates a user with no open leads without reassigning (T-10/T-28)', async () => {
    const repo = fakeRepo({ countOpenLeads: jest.fn().mockResolvedValue(0) });
    const reassign = fakeReassign();
    const audit = fakeAudit();
    const service = makeService(repo, { reassign, audit });

    const dto: UpdateUserDto = { status: UserStatus.INACTIVE };
    const result = await service.updateUser('user-1', dto, ADMIN, DataScope.A);

    expect(reassign.bulkReassign).not.toHaveBeenCalled();
    expect(repo.updateUser).toHaveBeenCalled();
    expect(result.status).toBe('active'); // from the mocked after-read; status write asserted via repo call
    const setArg = (repo.updateUser as jest.Mock).mock.calls[0][2];
    expect(setArg.status).toBe('inactive');
    expect((audit.append as jest.Mock).mock.calls[0][0].action).toBe('user_change');
  });

  it('returns CONFLICT with open_lead_count when deactivating with open leads and no reassign_to (T-11)', async () => {
    const repo = fakeRepo({ countOpenLeads: jest.fn().mockResolvedValue(3) });
    const service = makeService(repo);

    const dto: UpdateUserDto = { status: UserStatus.INACTIVE };
    try {
      await service.updateUser('user-1', dto, ADMIN, DataScope.A);
      fail('expected CONFLICT');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe('CONFLICT');
        expect(err.detail?.open_lead_count).toBe(3);
        expect(String(err.detail?.reason)).toContain('reassign_to');
      }
    }
    expect(repo.updateUser).not.toHaveBeenCalled();
  });

  it('deactivates and reassigns open leads via the port, audits reassign (T-12)', async () => {
    const repo = fakeRepo({ countOpenLeads: jest.fn().mockResolvedValue(3) });
    const reassign = fakeReassign();
    const audit = fakeAudit();
    const service = makeService(repo, { reassign, audit });

    const dto: UpdateUserDto = { status: UserStatus.INACTIVE, reassign_to: 'target-1' };
    await service.updateUser('user-1', dto, ADMIN, DataScope.A);

    expect(reassign.bulkReassign).toHaveBeenCalledWith('user-1', 'target-1', 'owner_deactivated', TX);
    const reassignAudit = (audit.append as jest.Mock).mock.calls.find((c) => c[0].action === 'reassign');
    expect(reassignAudit).toBeDefined();
    expect(reassignAudit[0].detail).toMatchObject({ bulk: true, reassigned_to: 'target-1', count: 3 });
  });

  it('rolls back (propagates) when the port throws mid-transaction (T-13)', async () => {
    const repo = fakeRepo({ countOpenLeads: jest.fn().mockResolvedValue(3) });
    const reassign = { bulkReassign: jest.fn().mockRejectedValue(new Error('reassign boom')) } as unknown as LeadReassignPort;
    const service = makeService(repo, { reassign });

    const dto: UpdateUserDto = { status: UserStatus.INACTIVE, reassign_to: 'target-1' };
    await expect(service.updateUser('user-1', dto, ADMIN, DataScope.A)).rejects.toThrow('reassign boom');
    expect(repo.updateUser).not.toHaveBeenCalled();
  });

  it('rejects reassign_to that is not an active user (VALIDATION_ERROR)', async () => {
    const repo = fakeRepo({
      countOpenLeads: jest.fn().mockResolvedValue(2),
      findStatus: jest.fn().mockResolvedValue({ user_id: 'target-1', status: UserStatus.INACTIVE, role_id: 'role-rm' }),
    });
    const service = makeService(repo);

    const dto: UpdateUserDto = { status: UserStatus.INACTIVE, reassign_to: 'target-1' };
    await expect(service.updateUser('user-1', dto, ADMIN, DataScope.A)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('reactivates an inactive user (T-14)', async () => {
    const repo = fakeRepo({
      findById: jest
        .fn()
        .mockResolvedValueOnce(userRow({ status: UserStatus.INACTIVE }))
        .mockResolvedValue(userRow({ status: UserStatus.ACTIVE })),
    });
    const service = makeService(repo);

    const dto: UpdateUserDto = { status: UserStatus.ACTIVE };
    const result = await service.updateUser('user-1', dto, ADMIN, DataScope.A);
    expect(result.status).toBe('active');
    const setArg = (repo.updateUser as jest.Mock).mock.calls[0][2];
    expect(setArg.status).toBe('active');
  });

  it('throws NOT_FOUND for an unknown user id (T-15)', async () => {
    const repo = fakeRepo({ findById: jest.fn().mockResolvedValue(undefined) });
    const service = makeService(repo);

    await expect(service.updateUser('nope', { full_name: 'X' }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('AdminUserService.listUsers', () => {
  it('returns rows + total and enforces scope-A', async () => {
    const repo = fakeRepo({
      listUsers: jest.fn().mockResolvedValue([userRow(), userRow({ user_id: 'user-2' })]),
      countUsers: jest.fn().mockResolvedValue(30),
    });
    const service = makeService(repo);

    const result = await service.listUsers({ page: 1, limit: 25 }, ADMIN, DataScope.A);
    expect(result.total).toBe(30);
    expect(result.rows).toHaveLength(2);
  });

  it('rejects a non scope-A caller (FORBIDDEN)', async () => {
    const service = makeService(fakeRepo());
    await expect(service.listUsers({ page: 1, limit: 25 }, ADMIN, DataScope.B)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
