import { z } from 'zod';
import { toast } from 'sonner';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useCreateTeam, useUpdateTeam } from '@/hooks/use-admin-teams';
import { useBranchOptions } from '@/hooks/use-admin-refdata';
import { useAdminUsers } from '@/hooks/use-admin-users';
import type { RefDataOption, TeamView, UserView } from '@/types/admin';

const optional = z.string().trim().optional().or(z.literal(''));
const BOOL_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

function onError(error: unknown): void {
  if (isApiClientError(error) && error.code === 'CONFLICT') {
    toast.error('A team with that name already exists for this branch.');
    return;
  }
  if (isApiClientError(error) && error.code === 'FORBIDDEN') {
    toast.error("You don't have access to perform this change.");
    return;
  }
  toast.error('Could not save the team. Please try again.');
}

function branchOpts(items: RefDataOption[]): Array<{ value: string; label: string }> {
  return items.map((b) => ({ value: b.id, label: b.code ? `${b.name} (${b.code})` : b.name }));
}

function managerOpts(users: UserView[]): Array<{ value: string; label: string }> {
  return users.map((u) => ({ value: u.user_id, label: `${u.full_name} (${u.username})` }));
}

/** FR-130 §UI — create or edit a team. Branch is required; manager optional. */
export function TeamForm({ team, onClose }: { team?: TeamView; onClose: () => void }): JSX.Element {
  return team ? <EditForm team={team} onClose={onClose} /> : <CreateForm onClose={onClose} />;
}

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Team name must be 2–120 characters.')
    .max(120, 'Team name must be 2–120 characters.'),
  branch_id: z.string().uuid('Select a branch.'),
  manager_id: optional,
});
type CreateValues = z.infer<typeof createSchema>;

function CreateForm({ onClose }: { onClose: () => void }): JSX.Element {
  const create = useCreateTeam();
  const branches = useBranchOptions();
  const managers = useAdminUsers({ page: 1, limit: 100, sort: '-created_at', status: 'active' });

  async function onSubmit(v: CreateValues): Promise<void> {
    await create.mutateAsync({
      name: v.name.trim(),
      branch_id: v.branch_id,
      ...(v.manager_id ? { manager_id: v.manager_id } : {}),
    });
    toast.success('Team created.');
    onClose();
  }

  return (
    <EntityForm
      schema={createSchema}
      defaultValues={{ name: '', branch_id: '', manager_id: '' }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Create team"
    >
      <FormField name="name" label="Team name" required />
      <FormSelect
        name="branch_id"
        label="Branch"
        required
        placeholder="Select a branch"
        options={branchOpts(branches.data ?? [])}
      />
      <FormSelect name="manager_id" label="Manager" placeholder="—" options={managerOpts(managers.data?.data ?? [])} />
    </EntityForm>
  );
}

const editSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Team name must be 2–120 characters.')
    .max(120, 'Team name must be 2–120 characters.'),
  branch_id: z.string().uuid('Select a branch.'),
  manager_id: optional,
  is_active: z.enum(['true', 'false']),
});
type EditValues = z.infer<typeof editSchema>;

function EditForm({ team, onClose }: { team: TeamView; onClose: () => void }): JSX.Element {
  const update = useUpdateTeam();
  const branches = useBranchOptions();
  const managers = useAdminUsers({ page: 1, limit: 100, sort: '-created_at', status: 'active' });

  async function onSubmit(v: EditValues): Promise<void> {
    await update.mutateAsync({
      teamId: team.team_id,
      body: {
        name: v.name.trim(),
        branch_id: v.branch_id,
        is_active: v.is_active === 'true',
        ...(v.manager_id ? { manager_id: v.manager_id } : {}),
      },
    });
    toast.success('Team updated.');
    onClose();
  }

  return (
    <EntityForm
      schema={editSchema}
      defaultValues={{
        name: team.name,
        branch_id: team.branch_id,
        manager_id: team.manager_id ?? '',
        is_active: team.is_active ? 'true' : 'false',
      }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Save changes"
    >
      <FormField name="name" label="Team name" required />
      <FormSelect
        name="branch_id"
        label="Branch"
        required
        options={branchOpts(branches.data ?? [])}
      />
      <FormSelect name="manager_id" label="Manager" placeholder="—" options={managerOpts(managers.data?.data ?? [])} />
      <FormSelect name="is_active" label="Status" options={BOOL_OPTIONS} />
    </EntityForm>
  );
}
