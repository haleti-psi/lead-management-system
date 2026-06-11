import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import { PaginationParams, ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { USERS_RESOURCE_TYPE } from './admin.constants';
import { AdminRoleService, type RoleWithPermissions } from './admin-role.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UuidParam } from './dto/uuid-param.dto';

/** The role view returned by `/admin/roles` (role attributes + permission set). */
interface RoleView {
  role_id: string;
  code: string;
  name: string;
  default_scope: string;
  is_external: boolean;
  permissions: Array<{ role_permission_id: string; capability: string; max_scope: string }>;
}

/**
 * FR-130 — `/api/v1/admin/roles` (list / update). The `roles` and
 * `role_permissions` tables are governed by the `user_mgmt` capability
 * (auth-matrix), so the same ABAC guard + scope-A floor as `/admin/users`
 * applies. `PATCH` replaces the role's permission set and evicts the ABAC cache
 * of affected users (E1).
 */
@Controller('admin/roles')
@Requires(Capability.USER_MGMT, () => ({ resourceType: USERS_RESOURCE_TYPE }))
export class AdminRolesController {
  constructor(private readonly service: AdminRoleService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(PaginationParams)) query: PaginationParams,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<RoleView[]>> {
    const { rows, total } = await this.service.listRoles(query.page, query.limit, user, req[EFFECTIVE_SCOPE_KEY]);
    return paginated(rows.map(toRoleView), { page: query.page, limit: query.limit, total });
  }

  @Patch(':id')
  async update(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdateRoleDto)) dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<RoleView> {
    const updated = await this.service.updateRole(id, dto, user, req[EFFECTIVE_SCOPE_KEY]);
    return toRoleView(updated);
  }
}

/** Map the service projection to the API view. */
function toRoleView(role: RoleWithPermissions): RoleView {
  return {
    role_id: role.role_id,
    code: role.code,
    name: role.name,
    default_scope: role.default_scope,
    is_external: role.is_external,
    permissions: role.permissions.map((p) => ({
      role_permission_id: p.role_permission_id,
      capability: p.capability,
      max_scope: p.max_scope,
    })),
  };
}
