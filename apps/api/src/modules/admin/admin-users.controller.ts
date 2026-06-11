import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { USERS_RESOURCE_TYPE } from './admin.constants';
import { AdminUserService } from './admin-user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQuery } from './dto/list-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UuidParam } from './dto/uuid-param.dto';
import type { UserListRow } from './user.repository';

/** The masked-serialisable user view returned by every `/admin/users` handler. */
interface UserView {
  user_id: string;
  username: string;
  full_name: string;
  email: string;
  mobile: string | null;
  role_id: string;
  role_code: string | null;
  branch_id: string | null;
  team_id: string | null;
  region_id: string | null;
  partner_id: string | null;
  product_skills: unknown;
  mfa_enabled: boolean;
  status: string;
  reporting_manager_id: string | null;
  last_login_at: string | null;
  created_at: string;
}

/**
 * FR-130 — `/api/v1/admin/users` (list / create / update). Protected by the
 * global `JwtAuthGuard` + `AbacGuard` via `@Requires('user_mgmt')` with the ABAC
 * resource pinned to `users` (auth-matrix `scoped:false`); only ADMIN holds
 * `user_mgmt: A`. The service enforces the org-wide scope-A floor. `email` and
 * `mobile` are masked by the global `MaskingInterceptor` (partial level) on the
 * way out — handlers return raw values. The `ResponseEnvelopeInterceptor` wraps
 * each return in `{ data, meta, error }`.
 */
@Controller('admin/users')
@Requires(Capability.USER_MGMT, () => ({ resourceType: USERS_RESOURCE_TYPE }))
export class AdminUsersController {
  constructor(private readonly service: AdminUserService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListUsersQuery)) query: ListUsersQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<UserView[]>> {
    const { rows, total } = await this.service.listUsers(query, user, req[EFFECTIVE_SCOPE_KEY]);
    return paginated(rows.map(toUserView), { page: query.page, limit: query.limit, total });
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(CreateUserDto)) dto: CreateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<UserView> {
    const created = await this.service.createUser(dto, user, req[EFFECTIVE_SCOPE_KEY]);
    return toUserView(created);
  }

  @Patch(':id')
  async update(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdateUserDto)) dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<UserView> {
    const updated = await this.service.updateUser(id, dto, user, req[EFFECTIVE_SCOPE_KEY]);
    return toUserView(updated);
  }
}

/** Map a repository row to the API view (ISO timestamps; password never present). */
function toUserView(row: UserListRow): UserView {
  return {
    user_id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    mobile: row.mobile,
    role_id: row.role_id,
    role_code: row.role_code,
    branch_id: row.branch_id,
    team_id: row.team_id,
    region_id: row.region_id,
    partner_id: row.partner_id,
    product_skills: row.product_skills,
    mfa_enabled: row.mfa_enabled,
    status: row.status,
    reporting_manager_id: row.reporting_manager_id,
    last_login_at: row.last_login_at != null ? new Date(row.last_login_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}
