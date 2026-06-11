import { Injectable } from '@nestjs/common';

import { AuditAction, DataScope, ERROR_CODES } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { ROLE_ENTITY_TYPE } from './admin.constants';
import type { UpdateRoleDto } from './dto/update-role.dto';
import { RoleRepository, type RolePermissionRow, type RoleRow } from './role.repository';

/** A role with its attached permission set (list/get projection). */
export interface RoleWithPermissions extends RoleRow {
  permissions: RolePermissionRow[];
}

/** Result of {@link AdminRoleService.listRoles} — roles + pagination total. */
export interface ListRolesResult {
  rows: RoleWithPermissions[];
  total: number;
}

/**
 * FR-130 — role + role_permissions administration (M14, ADMIN / `user_mgmt`,
 * scope A). Permission replacement (DELETE + INSERT) and any role-attribute
 * update commit atomically in one {@link UnitOfWork} transaction together with
 * the `role_change` audit intent.
 *
 * E1 (CORRECTIONS.md): after a permission change the ABAC cache of every active
 * user holding the role is evicted via
 * {@link EntitlementCacheService.invalidateRole}, so no stale capability grant
 * survives in Redis.
 */
@Injectable()
export class AdminRoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly cache: EntitlementCacheService,
  ) {}

  /** List roles with their permission sets (paginated). Read path. */
  async listRoles(
    page: number,
    limit: number,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<ListRolesResult> {
    this.requireScopeA(effectiveScope);
    const [rows, total] = await Promise.all([
      this.roles.listRoles(actor.orgId, page, limit),
      this.roles.countRoles(actor.orgId),
    ]);
    const permissions = await this.roles.listPermissionsForRoles(actor.orgId, rows.map((r) => r.role_id));
    const byRole = groupByRole(permissions);
    return {
      rows: rows.map((r) => ({ ...r, permissions: byRole.get(r.role_id) ?? [] })),
      total,
    };
  }

  /**
   * Update a role's `name` / `default_scope` and/or REPLACE its permission set.
   * Returns the updated role with its (new) permissions. Evicts the ABAC cache of
   * affected users when permissions change.
   */
  async updateRole(
    roleId: string,
    dto: UpdateRoleDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<RoleWithPermissions> {
    this.requireScopeA(effectiveScope);

    const { role, affectedUserIds, permissionsChanged } = await this.uow.run(async (tx) => {
      const existing = await this.roles.findById(actor.orgId, roleId, tx);
      if (!existing) throw new DomainException(ERROR_CODES.NOT_FOUND);

      if (dto.name !== undefined || dto.default_scope !== undefined) {
        const updated = await this.roles.updateRole(
          actor.orgId,
          roleId,
          { name: dto.name, default_scope: dto.default_scope },
          actor.userId,
          tx,
        );
        if (updated === 0) throw new DomainException(ERROR_CODES.NOT_FOUND);
      }

      let userIds: string[] = [];
      const permsChanged = dto.permissions !== undefined;
      if (dto.permissions !== undefined) {
        // Capture affected users BEFORE the change (the assignment set is unchanged
        // by a permission edit, but reading inside the tx keeps it consistent).
        userIds = await this.roles.listUserIdsForRole(actor.orgId, roleId, tx);
        await this.roles.replacePermissions(
          actor.orgId,
          roleId,
          dto.permissions.map((p) => ({ capability: p.capability, max_scope: p.max_scope })),
          actor.userId,
          tx,
        );
      }

      await this.audit.append(
        {
          action: AuditAction.ROLE_CHANGE,
          entity_type: ROLE_ENTITY_TYPE,
          entity_id: roleId,
          actor_id: actor.userId,
          org_id: actor.orgId,
          lead_id: null,
          detail: {
            changed_fields: Object.keys(dto),
            permission_count: dto.permissions?.length ?? null,
          },
        },
        tx,
      );

      const after = await this.roles.findById(actor.orgId, roleId, tx);
      if (!after) throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
      const perms = await this.roles.listPermissionsForRoles(actor.orgId, [roleId], tx);
      return {
        role: { ...after, permissions: perms } satisfies RoleWithPermissions,
        affectedUserIds: userIds,
        permissionsChanged: permsChanged,
      };
    });

    // E1: evict every affected actor's cached entitlement after commit.
    if (permissionsChanged) {
      await this.cache.invalidateRole(
        roleId,
        affectedUserIds.map((userId) => ({ userId, orgId: actor.orgId })),
      );
    }
    return role;
  }

  /** Org-wide role administration requires effective scope A. */
  private requireScopeA(effectiveScope: DataScope | undefined): void {
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }
}

/** Group permission rows by their `role_id`. */
function groupByRole(rows: RolePermissionRow[]): Map<string, RolePermissionRow[]> {
  const map = new Map<string, RolePermissionRow[]>();
  for (const row of rows) {
    const list = map.get(row.role_id);
    if (list) list.push(row);
    else map.set(row.role_id, [row]);
  }
  return map;
}
