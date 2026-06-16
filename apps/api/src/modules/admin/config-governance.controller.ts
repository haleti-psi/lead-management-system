import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { CONFIGURATION_RESOURCE_TYPE } from './admin.constants';
import {
  ConfigGovernanceService,
  type ApproveConfigResult,
  type PendingConfigVersionView,
  type RollbackConfigResult,
} from './config-governance.service';
import { ApproveConfigDto } from './dto/approve-config.dto';
import { ConfigIdParam } from './dto/config-id-param.dto';
import { ListConfigVersionsQuery } from './dto/list-config-versions.dto';
import { RollbackConfigDto } from './dto/rollback-config.dto';

/**
 * FR-132 — configuration governance endpoints (`/api/v1/admin/config` and
 * `/api/v1/admin/config/{id}/…`). All are protected by the global `JwtAuthGuard`
 * + `AbacGuard` via `@Requires('configuration')`; `configuration_versions` is
 * org-scoped config (auth-matrix `scoped:false`), so the resolver pins the ABAC
 * resource type. The service enforces the org-wide scope-A floor and the
 * maker≠checker rule. The global interceptor wraps each return in the
 * `{ data, meta, error }` envelope (the list hoists its pagination into `meta`).
 */
@Controller('admin/config')
@Requires(Capability.CONFIGURATION)
export class ConfigGovernanceController {
  constructor(private readonly service: ConfigGovernanceService) {}

  @Get()
  @Requires(Capability.CONFIGURATION, () => ({ resourceType: CONFIGURATION_RESOURCE_TYPE }))
  async listPending(
    @Query(new ZodValidationPipe(ListConfigVersionsQuery)) query: ListConfigVersionsQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<PendingConfigVersionView[]>> {
    const result = await this.service.listPending(user, query, req[EFFECTIVE_SCOPE_KEY]);
    return paginated(result.data, result.pagination);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Requires(Capability.CONFIGURATION, () => ({ resourceType: CONFIGURATION_RESOURCE_TYPE }))
  async approve(
    @Param('id', new ZodValidationPipe(ConfigIdParam)) id: string,
    @Body(new ZodValidationPipe(ApproveConfigDto)) dto: ApproveConfigDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<ApproveConfigResult> {
    return this.service.approve(id, dto, user, req[EFFECTIVE_SCOPE_KEY]);
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @Requires(Capability.CONFIGURATION, () => ({ resourceType: CONFIGURATION_RESOURCE_TYPE }))
  async rollback(
    @Param('id', new ZodValidationPipe(ConfigIdParam)) id: string,
    @Body(new ZodValidationPipe(RollbackConfigDto)) dto: RollbackConfigDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<RollbackConfigResult> {
    return this.service.rollback(id, dto, user, req[EFFECTIVE_SCOPE_KEY]);
  }
}
