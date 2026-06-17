import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import { MaskedField } from '@/components/ui/MaskedField';
import { DataTable, type DataTableColumn, type SortState } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/auth/capabilities';
import { useAdminUsers, useUpdateUser } from '@/hooks/use-admin-users';
import { useAdminRoles } from '@/hooks/use-admin-roles';
import { useAdminTeams, useUpdateTeam } from '@/hooks/use-admin-teams';
import type { RoleView, TeamView, UserView } from '@/types/admin';
import { UserForm } from './UserForm';
import { DeactivateUserDialog } from './DeactivateUserDialog';
import { RolePermissionsForm } from './RolePermissionsForm';
import { TeamForm } from './TeamForm';

const USER_STATUS_TONE: Readonly<Record<string, ChipTone>> = {
  active: 'success',
  inactive: 'neutral',
  locked: 'danger',
};

/** DataTable column id → server sort field (list-users.dto allow-list). */
const USER_SORT_FIELD: Readonly<Record<string, string>> = {
  full_name: 'full_name',
  username: 'username',
  created_at: 'created_at',
};

type TabId = 'users' | 'roles' | 'teams';
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
  { id: 'teams', label: 'Teams & Branches' },
];

/**
 * FR-130 §UI — User / Role / Team administration, mounted at `/users`
 * (capability `user_mgmt`, ADMIN). Three tabs: a server-paginated Users table
 * (masked email/mobile, status chips, edit / deactivate-reactivate actions), a
 * Roles table (view/edit permission sets), and Teams (create/edit/deactivate,
 * scoped to a branch). All write affordances are capability-gated; the server's
 * AbacGuard remains authoritative.
 */
export function UserAdminPage(): JSX.Element {
  const can = useCan();
  const canManage = can('user_mgmt');
  const [tab, setTab] = React.useState<TabId>('users');

  if (!canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">User Administration</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don't have access to user administration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="User Administration" description="Users, roles, teams and lead reassignment." />

      <div role="tablist" aria-label="Administration sections" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'users' ? <UsersSection /> : null}
        {tab === 'roles' ? <RolesSection /> : null}
        {tab === 'teams' ? <TeamsSection /> : null}
      </div>
    </div>
  );
}

// ─────────────────────────────── Users ───────────────────────────────

type UserModal = { mode: 'create' } | { mode: 'edit'; user: UserView } | null;

function UsersSection(): JSX.Element {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [status, setStatus] = React.useState('');
  const [modal, setModal] = React.useState<UserModal>(null);
  const [deactivating, setDeactivating] = React.useState<UserView | null>(null);

  const sortParam = sort
    ? `${sort.dir === 'desc' ? '-' : ''}${USER_SORT_FIELD[sort.columnId] ?? 'created_at'}`
    : '-created_at';
  const query = useAdminUsers({ page, limit, sort: sortParam, status: status || undefined });
  const result = query.data;
  const update = useUpdateUser();

  async function reactivate(user: UserView): Promise<void> {
    await update.mutateAsync({ userId: user.user_id, body: { status: 'active' } });
  }

  const columns: DataTableColumn<UserView>[] = [
    { id: 'full_name', header: 'Name', cell: (u) => u.full_name, sortable: true },
    { id: 'username', header: 'Username', cell: (u) => u.username, sortable: true },
    {
      id: 'email',
      header: 'Email',
      cell: (u) => <span aria-label="masked email">{u.email}</span>,
    },
    {
      id: 'mobile',
      header: 'Mobile',
      cell: (u) => (u.mobile ? <MaskedField maskedValue={u.mobile} fieldType="mobile" /> : '—'),
    },
    { id: 'role_code', header: 'Role', cell: (u) => u.role_code ?? '—' },
    {
      id: 'status',
      header: 'Status',
      cell: (u) => <StatusChip label={u.status} tone={USER_STATUS_TONE[u.status] ?? 'neutral'} />,
    },
    {
      id: 'last_login_at',
      header: 'Last login',
      cell: (u) => (u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '—'),
    },
    {
      id: 'actions',
      header: '',
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setModal({ mode: 'edit', user: u })}>
            Edit
          </Button>
          {u.status === 'active' ? (
            <Button variant="ghost" size="sm" onClick={() => setDeactivating(u)}>
              Deactivate
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => void reactivate(u)}>
              {u.status === 'locked' ? 'Unlock' : 'Reactivate'}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'locked', label: 'Locked' },
          ]}
        />
        <Button onClick={() => setModal({ mode: 'create' })}>
          <Plus className="h-4 w-4" aria-hidden />
          Create user
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(u) => u.user_id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        sort={sort}
        onSortChange={setSort}
        isLoading={query.isLoading}
        error={query.isError ? 'Could not load users.' : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No users found"
        emptyMessage="No users match the current filters."
      />

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit user' : 'Create user'}
      >
        {modal?.mode === 'edit' ? (
          <UserForm user={modal.user} onClose={() => setModal(null)} />
        ) : (
          <UserForm onClose={() => setModal(null)} />
        )}
      </Modal>

      {deactivating ? (
        <DeactivateUserDialog user={deactivating} onClose={() => setDeactivating(null)} />
      ) : null}
    </div>
  );
}

// ─────────────────────────────── Roles ───────────────────────────────

function RolesSection(): JSX.Element {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [editing, setEditing] = React.useState<RoleView | null>(null);

  const query = useAdminRoles({ page, limit });
  const result = query.data;

  const columns: DataTableColumn<RoleView>[] = [
    { id: 'code', header: 'Code', cell: (r) => r.code },
    { id: 'name', header: 'Name', cell: (r) => r.name },
    { id: 'default_scope', header: 'Default scope', cell: (r) => r.default_scope },
    { id: 'permission_count', header: 'Permissions', cell: (r) => r.permissions.length },
    {
      id: 'is_external',
      header: 'External',
      cell: (r) => (r.is_external ? 'Yes' : 'No'),
    },
    {
      id: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
            Edit permissions
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 pt-2">
      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(r) => r.role_id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={query.isLoading}
        error={query.isError ? 'Could not load roles.' : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No roles found"
        emptyMessage="No roles are configured."
      />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit role permissions">
        {editing ? <RolePermissionsForm role={editing} onClose={() => setEditing(null)} /> : null}
      </Modal>
    </div>
  );
}

// ─────────────────────────────── Teams ───────────────────────────────

type TeamModal = { mode: 'create' } | { mode: 'edit'; team: TeamView } | null;

function TeamsSection(): JSX.Element {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [isActive, setIsActive] = React.useState('');
  const [modal, setModal] = React.useState<TeamModal>(null);

  const query = useAdminTeams({ page, limit, isActive: isActive || undefined });
  const result = query.data;
  const update = useUpdateTeam();

  async function deactivate(team: TeamView): Promise<void> {
    await update.mutateAsync({ teamId: team.team_id, body: { is_active: false } });
  }

  const columns: DataTableColumn<TeamView>[] = [
    { id: 'name', header: 'Name', cell: (t) => t.name },
    { id: 'branch_id', header: 'Branch', cell: (t) => t.branch_id },
    { id: 'manager_id', header: 'Manager', cell: (t) => t.manager_id ?? '—' },
    {
      id: 'is_active',
      header: 'Status',
      cell: (t) => (
        <StatusChip label={t.is_active ? 'active' : 'inactive'} tone={t.is_active ? 'success' : 'neutral'} />
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setModal({ mode: 'edit', team: t })}>
            Edit
          </Button>
          {t.is_active ? (
            <Button variant="ghost" size="sm" onClick={() => void deactivate(t)}>
              Deactivate
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterSelect
          label="Status"
          value={isActive}
          onChange={(v) => {
            setIsActive(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All teams' },
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ]}
        />
        <Button onClick={() => setModal({ mode: 'create' })}>
          <Plus className="h-4 w-4" aria-hidden />
          Create team
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(t) => t.team_id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={query.isLoading}
        error={query.isError ? 'Could not load teams.' : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No teams found"
        emptyMessage="No teams match the current filters."
      />

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit team' : 'Create team'}
      >
        {modal?.mode === 'edit' ? (
          <TeamForm team={modal.team} onClose={() => setModal(null)} />
        ) : (
          <TeamForm onClose={() => setModal(null)} />
        )}
      </Modal>
    </div>
  );
}

// ─────────────────────────────── shared ───────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}): JSX.Element {
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
