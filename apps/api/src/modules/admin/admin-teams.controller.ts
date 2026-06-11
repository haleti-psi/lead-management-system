import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { USERS_RESOURCE_TYPE } from './admin.constants';
import { AdminTeamService } from './admin-team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { ListTeamsQuery } from './dto/list-teams.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { UuidParam } from './dto/uuid-param.dto';
import type { TeamRow } from './team.repository';

/** The team view returned by `/admin/teams`. */
interface TeamView {
  team_id: string;
  name: string;
  branch_id: string;
  manager_id: string | null;
  is_active: boolean;
}

/**
 * FR-130 — `/api/v1/admin/teams` (list / create / update). `teams` is governed by
 * the `user_mgmt` capability (auth-matrix), so the same ABAC guard + scope-A floor
 * as `/admin/users` applies. Deactivation is `PATCH … { is_active: false }`.
 */
@Controller('admin/teams')
@Requires(Capability.USER_MGMT, () => ({ resourceType: USERS_RESOURCE_TYPE }))
export class AdminTeamsController {
  constructor(private readonly service: AdminTeamService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListTeamsQuery)) query: ListTeamsQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<TeamView[]>> {
    const filters = { branch_id: query.filter?.branch_id, is_active: query.filter?.is_active };
    const { rows, total } = await this.service.listTeams(filters, query.page, query.limit, user, req[EFFECTIVE_SCOPE_KEY]);
    return paginated(rows.map(toTeamView), { page: query.page, limit: query.limit, total });
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(CreateTeamDto)) dto: CreateTeamDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<TeamView> {
    const created = await this.service.createTeam(dto, user, req[EFFECTIVE_SCOPE_KEY]);
    return toTeamView(created);
  }

  @Patch(':id')
  async update(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdateTeamDto)) dto: UpdateTeamDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<TeamView> {
    const updated = await this.service.updateTeam(id, dto, user, req[EFFECTIVE_SCOPE_KEY]);
    return toTeamView(updated);
  }
}

/** Map a repository row to the API view. */
function toTeamView(row: TeamRow): TeamView {
  return {
    team_id: row.team_id,
    name: row.name,
    branch_id: row.branch_id,
    manager_id: row.manager_id,
    is_active: row.is_active,
  };
}
