import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Capability, DataScope } from '@lms/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { isApiClientError } from '@/lib/api';
import { useUpdateRole } from '@/hooks/use-admin-roles';
import type { RoleView } from '@/types/admin';

const ALL_CAPABILITIES = Object.values(Capability);
const ALL_SCOPES = Object.values(DataScope);
const NAME_MIN = 2;
const NAME_MAX = 80;

/** Human label for a data scope (the matrix uses single-letter codes). */
const SCOPE_LABEL: Readonly<Record<string, string>> = {
  O: 'O — Own',
  T: 'T — Team',
  B: 'B — Branch',
  R: 'R — Region',
  A: 'A — All org',
  P: 'P — Partner',
  C: 'C — Customer',
  M: 'M — Mapped',
  X: 'X — None',
};

/**
 * FR-130 §UI — view & edit a role's name, default scope, and permission set. The
 * grid lists every capability; choosing a `max_scope` includes it, choosing "—"
 * excludes it. Submitting REPLACES the whole permission set (PATCH /admin/roles).
 * The role `code` is fixed and shown read-only (Assumption A-4).
 */
export function RolePermissionsForm({
  role,
  onClose,
}: {
  role: RoleView;
  onClose: () => void;
}): JSX.Element {
  const update = useUpdateRole();
  const [name, setName] = React.useState(role.name);
  const [defaultScope, setDefaultScope] = React.useState<string>(role.default_scope);
  const [grants, setGrants] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of role.permissions) initial[p.capability] = p.max_scope;
    return initial;
  });
  const [formError, setFormError] = React.useState<string | null>(null);

  const nameValid = name.trim().length >= NAME_MIN && name.trim().length <= NAME_MAX;

  function setGrant(capability: string, scope: string): void {
    setGrants((prev) => {
      const next = { ...prev };
      if (scope === '') delete next[capability];
      else next[capability] = scope;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    if (!nameValid) {
      setFormError('Name must be 2–80 characters.');
      return;
    }
    const permissions = Object.entries(grants).map(([capability, max_scope]) => ({
      capability: capability as Capability,
      max_scope: max_scope as DataScope,
    }));
    try {
      await update.mutateAsync({
        roleId: role.role_id,
        body: { name: name.trim(), default_scope: defaultScope as DataScope, permissions },
      });
      toast.success('Role updated.');
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'FORBIDDEN') {
        setFormError("You don't have access to edit roles.");
        return;
      }
      setFormError('Could not save the role. Please try again.');
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
      <p className="text-sm text-muted-foreground">
        Role code <span className="font-medium text-foreground">{role.code}</span>
        {role.is_external ? ' · external' : ''}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="role-name">
          Name
          <span className="text-destructive" aria-hidden>
            {' *'}
          </span>
        </Label>
        <Input
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-required
          aria-invalid={formError && !nameValid ? true : undefined}
          maxLength={NAME_MAX}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role-default-scope">Default scope</Label>
        <select
          id="role-default-scope"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={defaultScope}
          onChange={(e) => setDefaultScope(e.target.value)}
        >
          {ALL_SCOPES.map((s) => (
            <option key={s} value={s}>
              {SCOPE_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Permissions</legend>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Max scope</th>
              </tr>
            </thead>
            <tbody>
              {ALL_CAPABILITIES.map((cap) => {
                const selectId = `perm-${cap}`;
                return (
                  <tr key={cap} className="border-b last:border-0">
                    <td className="px-3 py-1.5">
                      <label htmlFor={selectId}>{cap}</label>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        id={selectId}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={grants[cap] ?? ''}
                        onChange={(e) => setGrant(cap, e.target.value)}
                      >
                        <option value="">— (not granted)</option>
                        {ALL_SCOPES.map((s) => (
                          <option key={s} value={s}>
                            {SCOPE_LABEL[s] ?? s}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      {formError ? (
        <p role="alert" aria-live="polite" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save role
        </Button>
      </div>
    </form>
  );
}
