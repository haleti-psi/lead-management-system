import { Inject, Injectable } from '@nestjs/common';

import type { Capability, DataScope } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { MAX_PAGE_LIMIT } from './dto/list-users.dto';

/** A `roles` row (without audit columns) for the list/get projection. */
export interface RoleRow {
  role_id: string;
  code: string;
  name: string;
  default_scope: DataScope;
  is_external: boolean;
}

/** A `role_permissions` row for the permission projection. */
export interface RolePermissionRow {
  role_permission_id: string;
  role_id: string;
  capability: Capability;
  max_scope: DataScope;
}

/** A permission to write in {@link RoleRepository.replacePermissions}. */
export interface PermissionToWrite {
  capability: Capability;
  max_scope: DataScope;
}

/** Patch for {@link RoleRepository.updateRole}; only present keys are set. */
export interface UpdateRoleValues {
  name?: string;
  default_scope?: DataScope;
}

/**
 * Cap on bulk inserts / scans (NFR LIMIT guard). A role's permission set is small
 * (≤ the capability enum size); 100 is a safe ceiling that the schema's
 * `uq_role_permissions(role_id, capability)` already bounds.
 */
const PERMISSIONS_LIMIT = MAX_PAGE_LIMIT;

/**
 * FR-130 — owner repository for `roles` + `role_permissions` (M1/M14, ADMIN). All
 * queries are parameterised Kysely, `org_id`-scoped, and `LIMIT`-bounded. Role
 * `code` is immutable (Assumption A-4); only `name`/`default_scope` and the
 * permission set change. Permission replacement is a DELETE-then-INSERT that the
 * service runs inside one transaction so the set is swapped atomically.
 */
@Injectable()
export class RoleRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Paginated list of roles in the org. Read-only. */
  async listRoles(orgId: string, page: number, limit: number, tx?: DbTransaction): Promise<RoleRow[]> {
    const bounded = Math.min(limit, MAX_PAGE_LIMIT);
    const executor = tx ?? this.db;
    return executor
      .selectFrom('roles')
      .select(['role_id', 'code', 'name', 'default_scope', 'is_external'])
      .where('org_id', '=', orgId)
      .orderBy('code', 'asc')
      .limit(bounded)
      .offset((page - 1) * bounded)
      .execute();
  }

  /** Total role count in the org (pagination meta). Read-only. */
  async countRoles(orgId: string, tx?: DbTransaction): Promise<number> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('roles')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('org_id', '=', orgId)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Fetch a single role by id within the org. Read-only. */
  async findById(orgId: string, roleId: string, tx?: DbTransaction): Promise<RoleRow | undefined> {
    const executor = tx ?? this.db;
    return executor
      .selectFrom('roles')
      .select(['role_id', 'code', 'name', 'default_scope', 'is_external'])
      .where('org_id', '=', orgId)
      .where('role_id', '=', roleId)
      .executeTakeFirst();
  }

  /**
   * All permission rows for the given role ids in the org (used to attach
   * `permissions[]` to a role list/get). `LIMIT`-bounded. Read-only.
   */
  async listPermissionsForRoles(
    orgId: string,
    roleIds: readonly string[],
    tx?: DbTransaction,
  ): Promise<RolePermissionRow[]> {
    if (roleIds.length === 0) return [];
    const executor = tx ?? this.db;
    return executor
      .selectFrom('role_permissions')
      .select(['role_permission_id', 'role_id', 'capability', 'max_scope'])
      .where('org_id', '=', orgId)
      .where('role_id', 'in', [...roleIds])
      .orderBy('capability', 'asc')
      .limit(PERMISSIONS_LIMIT)
      .execute();
  }

  /** Update a role's `name` / `default_scope`. Returns rows updated (0 ⇒ absent). */
  async updateRole(
    orgId: string,
    roleId: string,
    values: UpdateRoleValues,
    actorId: string,
    tx: DbTransaction,
  ): Promise<number> {
    const result = await tx
      .updateTable('roles')
      .set({ ...values, updated_by: actorId, updated_at: new Date() })
      .where('org_id', '=', orgId)
      .where('role_id', '=', roleId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /**
   * Replace a role's entire permission set: DELETE existing rows, then INSERT the
   * new ones. Both steps run inside the caller's transaction (atomic swap). A
   * `null`/empty `permissions` array clears the set.
   */
  async replacePermissions(
    orgId: string,
    roleId: string,
    permissions: readonly PermissionToWrite[],
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .deleteFrom('role_permissions')
      .where('org_id', '=', orgId)
      .where('role_id', '=', roleId)
      .execute();

    if (permissions.length === 0) return;

    await tx
      .insertInto('role_permissions')
      .values(
        permissions.map((p) => ({
          org_id: orgId,
          role_id: roleId,
          capability: p.capability,
          max_scope: p.max_scope,
          created_by: actorId,
          updated_by: actorId,
        })),
      )
      .execute();
  }

  /**
   * The active user ids in the org currently assigned this role (E1 cache
   * invalidation: every cached actor with this role must be evicted after a
   * permission change). `LIMIT`-bounded. Read-only.
   */
  async listUserIdsForRole(orgId: string, roleId: string, tx?: DbTransaction): Promise<string[]> {
    const executor = tx ?? this.db;
    const rows = await executor
      .selectFrom('users')
      .select('user_id')
      .where('org_id', '=', orgId)
      .where('role_id', '=', roleId)
      .where('status', '=', 'active')
      .limit(MAX_PAGE_LIMIT)
      .execute();
    return rows.map((r) => r.user_id);
  }
}
