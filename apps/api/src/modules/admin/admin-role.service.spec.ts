import { DataScope } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { AdminRoleService } from './admin-role.service';
import { RoleRepository, type RolePermissionRow, type RoleRow } from './role.repository';
import type { UpdateRoleDto } from './dto/update-role.dto';

/**
 * FR-130 unit tests for {@link AdminRoleService}: permission replacement + audit
 * (T-18/T-19), NOT_FOUND (T-20), scope-A floor (T-21 defence-in-depth), and the
 * E1 ABAC-cache invalidation of affected users on a permission change.
 */

const TX = { __tx: true } as const;
const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN: AuthUser = { userId: 'admin-1', orgId: ORG, role: 'ADMIN' as AuthUser['role'], scope: DataScope.A, jti: 'j' };

function roleRow(overrides: Partial<RoleRow> = {}): RoleRow {
  return { role_id: 'role-bm', code: 'BM', name: 'Branch Manager', default_scope: DataScope.B, is_external: false, ...overrides };
}
function perm(capability: string, scope: DataScope = DataScope.B): RolePermissionRow {
  return { role_permission_id: `rp-${capability}`, role_id: 'role-bm', capability: capability as RolePermissionRow['capability'], max_scope: scope };
}

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}
function fakeCache(): EntitlementCacheService {
  return {
    invalidateRole: jest.fn().mockResolvedValue(undefined),
    invalidateUser: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntitlementCacheService;
}

type RepoMock = Record<keyof RoleRepository, jest.Mock>;
function fakeRepo(overrides: Partial<RepoMock> = {}): RoleRepository {
  const base: Partial<RepoMock> = {
    listRoles: jest.fn().mockResolvedValue([roleRow()]),
    countRoles: jest.fn().mockResolvedValue(1),
    findById: jest.fn().mockResolvedValue(roleRow()),
    listPermissionsForRoles: jest.fn().mockResolvedValue([perm('create_lead'), perm('view_lead'), perm('edit_lead')]),
    updateRole: jest.fn().mockResolvedValue(1),
    replacePermissions: jest.fn().mockResolvedValue(undefined),
    listUserIdsForRole: jest.fn().mockResolvedValue(['user-a', 'user-b']),
    listAllUserIdsForRole: jest.fn().mockResolvedValue(['user-a', 'user-b']),
  };
  return { ...base, ...overrides } as unknown as RoleRepository;
}

function makeService(repo: RoleRepository, cache = fakeCache(), audit = fakeAudit()): { service: AdminRoleService; cache: EntitlementCacheService; audit: AuditAppender } {
  return { service: new AdminRoleService(repo, fakeUow(), audit, cache), cache, audit };
}

describe('AdminRoleService.listRoles', () => {
  it('attaches the permission set to each role (T-17)', async () => {
    const repo = fakeRepo();
    const { service } = makeService(repo);

    const result = await service.listRoles(1, 25, ADMIN, DataScope.A);
    expect(result.total).toBe(1);
    expect(result.rows[0]?.permissions).toHaveLength(3);
  });
});

describe('AdminRoleService.updateRole', () => {
  it('replaces permissions, audits role_change, and invalidates affected users (T-18/T-19/E1)', async () => {
    const repo = fakeRepo();
    const { service, cache, audit } = makeService(repo);

    const dto: UpdateRoleDto = {
      permissions: [
        { capability: 'create_lead', max_scope: DataScope.B },
        { capability: 'view_lead', max_scope: DataScope.B },
        { capability: 'edit_lead', max_scope: DataScope.B },
      ],
    };
    const result = await service.updateRole('role-bm', dto, ADMIN, DataScope.A);

    expect(repo.replacePermissions).toHaveBeenCalledWith(
      ORG,
      'role-bm',
      [
        { capability: 'create_lead', max_scope: 'B' },
        { capability: 'view_lead', max_scope: 'B' },
        { capability: 'edit_lead', max_scope: 'B' },
      ],
      'admin-1',
      TX,
    );
    expect((audit.append as jest.Mock).mock.calls[0][0].action).toBe('role_change');
    expect(cache.invalidateRole).toHaveBeenCalledWith('role-bm', [
      { userId: 'user-a', orgId: ORG },
      { userId: 'user-b', orgId: ORG },
    ]);
    expect(result.permissions).toHaveLength(3);
  });

  it('does NOT invalidate the cache when only name/scope changes (no permission edit)', async () => {
    const repo = fakeRepo();
    const { service, cache } = makeService(repo);

    await service.updateRole('role-bm', { name: 'Branch Mgr' }, ADMIN, DataScope.A);

    expect(repo.replacePermissions).not.toHaveBeenCalled();
    expect(cache.invalidateRole).not.toHaveBeenCalled();
    expect(repo.updateRole).toHaveBeenCalled();
  });

  it('throws NOT_FOUND for an unknown role id (T-20)', async () => {
    const repo = fakeRepo({ findById: jest.fn().mockResolvedValue(undefined) });
    const { service } = makeService(repo);

    await expect(service.updateRole('nope', { name: 'X' }, ADMIN, DataScope.A)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a non scope-A caller with FORBIDDEN (T-21 defence-in-depth)', async () => {
    const repo = fakeRepo();
    const { service } = makeService(repo);

    await expect(service.updateRole('role-bm', { name: 'X' }, ADMIN, DataScope.B)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
