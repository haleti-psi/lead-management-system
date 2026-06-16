// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { RoleView, TeamView, UserView } from '@/types/admin';

const mocks = vi.hoisted(() => ({
  users: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  roles: vi.fn(),
  updateRole: vi.fn(),
  teams: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  branches: vi.fn(),
  regions: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/hooks/use-admin-users', () => ({
  useAdminUsers: () => mocks.users(),
  useCreateUser: () => ({ mutateAsync: mocks.createUser, isPending: false }),
  useUpdateUser: () => ({ mutateAsync: mocks.updateUser, isPending: false }),
}));
vi.mock('@/hooks/use-admin-roles', () => ({
  useAdminRoles: () => mocks.roles(),
  useUpdateRole: () => ({ mutateAsync: mocks.updateRole, isPending: false }),
}));
vi.mock('@/hooks/use-admin-teams', () => ({
  useAdminTeams: () => mocks.teams(),
  useCreateTeam: () => ({ mutateAsync: mocks.createTeam, isPending: false }),
  useUpdateTeam: () => ({ mutateAsync: mocks.updateTeam, isPending: false }),
}));
vi.mock('@/hooks/use-admin-refdata', () => ({
  useBranchOptions: () => mocks.branches(),
  useRegionOptions: () => mocks.regions(),
}));
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UserAdminPage } from './UserAdminPage';

function user(overrides: Partial<UserView> = {}): UserView {
  return {
    user_id: 'u1',
    username: 'jdoe',
    full_name: 'Jane Doe',
    email: 'j***@example.com',
    mobile: '98xxxxxx10',
    role_id: 'r1',
    role_code: 'BM',
    branch_id: 'b1',
    team_id: 't1',
    region_id: null,
    partner_id: null,
    product_skills: ['CV'],
    mfa_enabled: true,
    status: 'active',
    reporting_manager_id: null,
    last_login_at: '2026-06-09T10:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function role(overrides: Partial<RoleView> = {}): RoleView {
  return {
    role_id: 'r1',
    code: 'BM',
    name: 'Branch Manager',
    default_scope: 'B',
    is_external: false,
    permissions: [{ role_permission_id: 'rp1', capability: 'create_lead', max_scope: 'B' }],
    ...overrides,
  };
}

function team(overrides: Partial<TeamView> = {}): TeamView {
  return { team_id: 't1', name: 'North HL', branch_id: 'b1', manager_id: null, is_active: true, ...overrides };
}

function listResult<T>(rows: T[], total = rows.length) {
  return { data: { data: rows, pagination: { page: 1, limit: 25, total } }, isLoading: false, isError: false, refetch: vi.fn() };
}

function setDefaults(): void {
  mocks.users.mockReturnValue(listResult([user()]));
  mocks.roles.mockReturnValue(listResult([role()]));
  mocks.teams.mockReturnValue(listResult([team()]));
  mocks.branches.mockReturnValue({ data: [{ id: 'b1', code: 'BR1', name: 'Mumbai' }], isLoading: false });
  mocks.regions.mockReturnValue({ data: [{ id: 'rg1', code: 'W', name: 'West' }], isLoading: false });
}

describe('UserAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
    setDefaults();
  });

  it('renders the users table with a masked email/mobile and a status chip', () => {
    render(<UserAdminPage />);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('j***@example.com')).toBeTruthy();
    expect(screen.getByText('98xxxxxx10')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('hides the page when the user lacks the user_mgmt capability', () => {
    mocks.can.mockReturnValue(false);
    render(<UserAdminPage />);
    expect(screen.getByText(/don't have access to user administration/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create user/i })).toBeNull();
  });

  it('opens the create-user modal with the form fields', () => {
    render(<UserAdminPage />);
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText(/username/i)).toBeTruthy();
    expect(dialog.getByLabelText(/email/i)).toBeTruthy();
  });

  it('blocks create submit and shows inline validation errors for empty required fields', async () => {
    render(<UserAdminPage />);
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: /create user/i }));

    const alerts = await dialog.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('shows the empty state when there are no users', () => {
    mocks.users.mockReturnValue(listResult([], 0));
    render(<UserAdminPage />);
    expect(screen.getByText('No users found')).toBeTruthy();
  });

  it('shows the error state when the users query fails', () => {
    mocks.users.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<UserAdminPage />);
    expect(screen.getByText('Could not load users.')).toBeTruthy();
  });

  it('switches to the Roles tab and lists role rows', () => {
    render(<UserAdminPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Roles' }));
    expect(screen.getByText('Branch Manager')).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit permissions/i })).toBeTruthy();
  });

  it('switches to the Teams tab and lists team rows', () => {
    render(<UserAdminPage />);
    fireEvent.click(screen.getByRole('tab', { name: /teams/i }));
    expect(screen.getByText('North HL')).toBeTruthy();
    expect(screen.getByRole('button', { name: /create team/i })).toBeTruthy();
  });

  it('reactivates an inactive user via PATCH status=active', async () => {
    mocks.users.mockReturnValue(listResult([user({ status: 'inactive' })]));
    mocks.updateUser.mockResolvedValue(user({ status: 'active' }));
    render(<UserAdminPage />);
    fireEvent.click(screen.getByRole('button', { name: /reactivate/i }));
    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({ userId: 'u1', body: { status: 'active' } }),
    );
  });
});
