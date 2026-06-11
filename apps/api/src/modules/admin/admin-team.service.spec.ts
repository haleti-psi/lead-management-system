import { DataScope, UserStatus } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { AdminTeamService } from './admin-team.service';
import { TeamRepository, type TeamRow } from './team.repository';
import { UserRepository } from './user.repository';
import type { CreateTeamDto } from './dto/create-team.dto';

/**
 * FR-130 unit tests for {@link AdminTeamService}: create with branch FK check
 * (T-22/T-24), deactivation via is_active (T-25), and the scope-A floor. The
 * branch/manager existence checks are delegated to {@link UserRepository} helpers
 * (mocked here).
 */

const TX = { __tx: true } as const;
const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN: AuthUser = { userId: 'admin-1', orgId: ORG, role: 'ADMIN' as AuthUser['role'], scope: DataScope.A, jti: 'j' };

function teamRow(overrides: Partial<TeamRow> = {}): TeamRow {
  return { team_id: 'team-1', name: 'North HL', branch_id: 'branch-1', manager_id: null, is_active: true, ...overrides };
}

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}
function fakeTeams(overrides: Partial<Record<keyof TeamRepository, jest.Mock>> = {}): TeamRepository {
  const base = {
    listTeams: jest.fn().mockResolvedValue([teamRow()]),
    countTeams: jest.fn().mockResolvedValue(1),
    findById: jest.fn().mockResolvedValue(teamRow()),
    createTeam: jest.fn().mockResolvedValue('team-1'),
    updateTeam: jest.fn().mockResolvedValue(1),
  };
  return { ...base, ...overrides } as unknown as TeamRepository;
}
function fakeUsers(overrides: Partial<Record<keyof UserRepository, jest.Mock>> = {}): UserRepository {
  const base = {
    branchActive: jest.fn().mockResolvedValue(true),
    findStatus: jest.fn().mockResolvedValue({ user_id: 'mgr-1', status: UserStatus.ACTIVE, role_id: 'role-bm' }),
  };
  return { ...base, ...overrides } as unknown as UserRepository;
}

function makeService(teams: TeamRepository, users: UserRepository, audit = fakeAudit()): AdminTeamService {
  return new AdminTeamService(teams, users, fakeUow(), audit);
}

const CREATE_DTO: CreateTeamDto = { name: 'North HL', branch_id: 'branch-1' };

describe('AdminTeamService.createTeam', () => {
  it('creates a team and audits user_change with entity_type=team (T-22)', async () => {
    const teams = fakeTeams();
    const audit = fakeAudit();
    const service = makeService(teams, fakeUsers(), audit);

    const result = await service.createTeam(CREATE_DTO, ADMIN, DataScope.A);

    expect(result.team_id).toBe('team-1');
    const arg = (audit.append as jest.Mock).mock.calls[0][0];
    expect(arg.action).toBe('user_change');
    expect(arg.entity_type).toBe('team');
  });

  it('throws NOT_FOUND when branch_id does not exist/inactive (T-24)', async () => {
    const teams = fakeTeams();
    const users = fakeUsers({ branchActive: jest.fn().mockResolvedValue(false) });
    const service = makeService(teams, users);

    await expect(service.createTeam(CREATE_DTO, ADMIN, DataScope.A)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(teams.createTeam).not.toHaveBeenCalled();
  });

  it('validates an active manager when manager_id is supplied', async () => {
    const teams = fakeTeams();
    const users = fakeUsers({ findStatus: jest.fn().mockResolvedValue({ user_id: 'mgr-1', status: UserStatus.INACTIVE, role_id: 'r' }) });
    const service = makeService(teams, users);

    await expect(service.createTeam({ ...CREATE_DTO, manager_id: 'mgr-1' }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a non scope-A caller with FORBIDDEN', async () => {
    const service = makeService(fakeTeams(), fakeUsers());
    await expect(service.createTeam(CREATE_DTO, ADMIN, DataScope.B)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('AdminTeamService.updateTeam', () => {
  it('deactivates a team via is_active=false (T-25)', async () => {
    const teams = fakeTeams({
      findById: jest.fn().mockResolvedValueOnce(teamRow()).mockResolvedValue(teamRow({ is_active: false })),
    });
    const service = makeService(teams, fakeUsers());

    const result = await service.updateTeam('team-1', { is_active: false }, ADMIN, DataScope.A);
    expect(result.is_active).toBe(false);
    const setArg = (teams.updateTeam as jest.Mock).mock.calls[0][2];
    expect(setArg.is_active).toBe(false);
  });

  it('throws NOT_FOUND for an unknown team', async () => {
    const teams = fakeTeams({ findById: jest.fn().mockResolvedValue(undefined) });
    const service = makeService(teams, fakeUsers());

    await expect(service.updateTeam('nope', { is_active: false }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
