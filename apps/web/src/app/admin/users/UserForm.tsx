import { z } from 'zod';
import { toast } from 'sonner';
import { ProductCode } from '@lms/shared';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useCreateUser, useUpdateUser } from '@/hooks/use-admin-users';
import { useBranchOptions, useRegionOptions } from '@/hooks/use-admin-refdata';
import { useAdminRoles } from '@/hooks/use-admin-roles';
import { useAdminTeams } from '@/hooks/use-admin-teams';
import type { CreateUserBody, RefDataOption, RoleView, TeamView, UserView } from '@/types/admin';

const PRODUCT_CODES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];
const PRODUCT_SET = new Set<string>(PRODUCT_CODES);
const BOOL_OPTIONS = [
  { value: 'false', label: 'No' },
  { value: 'true', label: 'Yes' },
];

const optional = z.string().trim().optional().or(z.literal(''));
const mobile = z
  .string()
  .regex(/^[6-9][0-9]{9}$/, 'Mobile must be a 10-digit Indian mobile number.')
  .optional()
  .or(z.literal(''));
const productSkills = z
  .string()
  .optional()
  .refine(
    (v) => !v?.trim() || v.split(',').every((p) => PRODUCT_SET.has(p.trim().toUpperCase())),
    'Each product skill must be a valid product code.',
  );

function splitProducts(value?: string): ProductCode[] | undefined {
  if (!value?.trim()) return undefined;
  const codes = value
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter((p): p is ProductCode => PRODUCT_SET.has(p));
  return codes.length > 0 ? codes : undefined;
}

function onError(error: unknown): void {
  if (isApiClientError(error) && error.code === 'CONFLICT') {
    toast.error('A user with that username or email already exists.');
    return;
  }
  if (isApiClientError(error) && error.code === 'FORBIDDEN') {
    toast.error("You don't have access to perform this change.");
    return;
  }
  toast.error('Could not save the user. Please try again.');
}

/** Build the `{ value, label }` lists the assignment Selects render from the
 * loaded reference data (roles/teams/branches/regions/managers). */
function useUserFormOptions(): {
  roles: RoleView[];
  teams: TeamView[];
  branches: RefDataOption[];
  regions: RefDataOption[];
} {
  const roles = useAdminRoles({ page: 1, limit: 100 });
  const teams = useAdminTeams({ page: 1, limit: 100, isActive: 'true' });
  const branches = useBranchOptions();
  const regions = useRegionOptions();
  return {
    roles: roles.data?.data ?? [],
    teams: teams.data?.data ?? [],
    branches: branches.data ?? [],
    regions: regions.data ?? [],
  };
}

function refOptions(items: RefDataOption[]): Array<{ value: string; label: string }> {
  return items.map((b) => ({ value: b.id, label: b.code ? `${b.name} (${b.code})` : b.name }));
}

/** FR-130 §UI — create or edit a user. `username`/`email` are create-only
 * (immutable on edit per the UpdateUserDto); status changes are handled by the
 * deactivate/reactivate dialog, not this form. */
export function UserForm({ user, onClose }: { user?: UserView; onClose: () => void }): JSX.Element {
  return user ? <EditForm user={user} onClose={onClose} /> : <CreateForm onClose={onClose} />;
}

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be 3–150 alphanumeric/dot/dash characters.')
    .max(150, 'Username must be 3–150 alphanumeric/dot/dash characters.')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username must be 3–150 alphanumeric/dot/dash characters.'),
  email: z.string().trim().max(255).email('Must be a valid email address.'),
  full_name: z
    .string()
    .trim()
    .min(2, 'Full name must be 2–150 characters.')
    .max(150, 'Full name must be 2–150 characters.'),
  mobile,
  role_id: z.string().uuid('Select a role.'),
  branch_id: optional,
  team_id: optional,
  region_id: optional,
  partner_id: optional,
  product_skills: productSkills,
  reporting_manager_id: optional,
  mfa_enabled: z.enum(['true', 'false']),
});
type CreateValues = z.infer<typeof createSchema>;

function buildBody(v: CreateValues): CreateUserBody {
  return {
    username: v.username.trim(),
    email: v.email.trim(),
    full_name: v.full_name.trim(),
    role_id: v.role_id,
    mfa_enabled: v.mfa_enabled === 'true',
    ...(v.mobile ? { mobile: v.mobile } : {}),
    ...(v.branch_id ? { branch_id: v.branch_id } : {}),
    ...(v.team_id ? { team_id: v.team_id } : {}),
    ...(v.region_id ? { region_id: v.region_id } : {}),
    ...(v.partner_id ? { partner_id: v.partner_id } : {}),
    ...(splitProducts(v.product_skills) ? { product_skills: splitProducts(v.product_skills) } : {}),
    ...(v.reporting_manager_id ? { reporting_manager_id: v.reporting_manager_id } : {}),
  };
}

function CreateForm({ onClose }: { onClose: () => void }): JSX.Element {
  const create = useCreateUser();
  const { roles, teams, branches, regions } = useUserFormOptions();
  const managerOptions = teamManagerOptions(teams);

  async function onSubmit(v: CreateValues): Promise<void> {
    await create.mutateAsync(buildBody(v));
    toast.success('User created.');
    onClose();
  }

  return (
    <EntityForm
      schema={createSchema}
      defaultValues={{
        username: '',
        email: '',
        full_name: '',
        mobile: '',
        role_id: '',
        branch_id: '',
        team_id: '',
        region_id: '',
        partner_id: '',
        product_skills: '',
        reporting_manager_id: '',
        mfa_enabled: 'false',
      }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Create user"
    >
      <FormField name="username" label="Username" required autoComplete="off" />
      <FormField name="email" label="Email" type="email" required autoComplete="off" />
      <FormField name="full_name" label="Full name" required />
      <FormField name="mobile" label="Mobile" inputMode="numeric" />
      <FormSelect
        name="role_id"
        label="Role"
        required
        placeholder="Select a role"
        options={roles.map((r) => ({ value: r.role_id, label: `${r.name} (${r.code})` }))}
      />
      <FormSelect name="branch_id" label="Branch" placeholder="—" options={refOptions(branches)} />
      <FormSelect
        name="team_id"
        label="Team"
        placeholder="—"
        options={teams.map((t) => ({ value: t.team_id, label: t.name }))}
      />
      <FormSelect name="region_id" label="Region" placeholder="—" options={refOptions(regions)} />
      <FormSelect name="reporting_manager_id" label="Reporting manager" placeholder="—" options={managerOptions} />
      <FormField name="product_skills" label="Product skills (comma-separated codes)" placeholder="CV, CAR" />
      <FormSelect name="mfa_enabled" label="MFA enabled" options={BOOL_OPTIONS} />
    </EntityForm>
  );
}

const editSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Full name must be 2–150 characters.')
    .max(150, 'Full name must be 2–150 characters.'),
  mobile,
  role_id: z.string().uuid('Select a role.'),
  branch_id: optional,
  team_id: optional,
  region_id: optional,
  partner_id: optional,
  product_skills: productSkills,
  reporting_manager_id: optional,
  mfa_enabled: z.enum(['true', 'false']),
});
type EditValues = z.infer<typeof editSchema>;

function EditForm({ user, onClose }: { user: UserView; onClose: () => void }): JSX.Element {
  const update = useUpdateUser();
  const { roles, teams, branches, regions } = useUserFormOptions();
  const managerOptions = teamManagerOptions(teams).filter((m) => m.value !== user.user_id);

  async function onSubmit(v: EditValues): Promise<void> {
    await update.mutateAsync({
      userId: user.user_id,
      body: {
        full_name: v.full_name.trim(),
        role_id: v.role_id,
        mfa_enabled: v.mfa_enabled === 'true',
        ...(v.mobile ? { mobile: v.mobile } : {}),
        ...(v.branch_id ? { branch_id: v.branch_id } : {}),
        ...(v.team_id ? { team_id: v.team_id } : {}),
        ...(v.region_id ? { region_id: v.region_id } : {}),
        ...(v.partner_id ? { partner_id: v.partner_id } : {}),
        ...(splitProducts(v.product_skills) ? { product_skills: splitProducts(v.product_skills) } : {}),
        ...(v.reporting_manager_id ? { reporting_manager_id: v.reporting_manager_id } : {}),
      },
    });
    toast.success('User updated.');
    onClose();
  }

  return (
    <EntityForm
      schema={editSchema}
      defaultValues={{
        full_name: user.full_name,
        mobile: '',
        role_id: user.role_id,
        branch_id: user.branch_id ?? '',
        team_id: user.team_id ?? '',
        region_id: user.region_id ?? '',
        partner_id: user.partner_id ?? '',
        product_skills: (user.product_skills ?? []).join(', '),
        reporting_manager_id: user.reporting_manager_id ?? '',
        mfa_enabled: user.mfa_enabled ? 'true' : 'false',
      }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Save changes"
    >
      <p className="text-sm text-muted-foreground">
        {user.username} · {user.email}
      </p>
      <FormField name="full_name" label="Full name" required />
      <FormField name="mobile" label="Mobile (leave blank to keep)" inputMode="numeric" />
      <FormSelect
        name="role_id"
        label="Role"
        required
        options={roles.map((r) => ({ value: r.role_id, label: `${r.name} (${r.code})` }))}
      />
      <FormSelect name="branch_id" label="Branch" placeholder="—" options={refOptions(branches)} />
      <FormSelect
        name="team_id"
        label="Team"
        placeholder="—"
        options={teams.map((t) => ({ value: t.team_id, label: t.name }))}
      />
      <FormSelect name="region_id" label="Region" placeholder="—" options={refOptions(regions)} />
      <FormSelect name="reporting_manager_id" label="Reporting manager" placeholder="—" options={managerOptions} />
      <FormField name="product_skills" label="Product skills (comma-separated codes)" placeholder="CV, CAR" />
      <FormSelect name="mfa_enabled" label="MFA enabled" options={BOOL_OPTIONS} />
    </EntityForm>
  );
}

/** Distinct team managers as `{ value, label }` (reporting-manager candidates).
 * Teams carry a `manager_id`; we surface those, de-duplicated. */
function teamManagerOptions(teams: TeamView[]): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const t of teams) {
    if (t.manager_id && !seen.has(t.manager_id)) {
      seen.add(t.manager_id);
      out.push({ value: t.manager_id, label: `Manager of ${t.name}` });
    }
  }
  return out;
}
