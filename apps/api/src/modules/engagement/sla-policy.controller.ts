import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { ListSlaPoliciesQueryDto } from './dto/list-sla-policies.dto';
import { SlaPolicyService, type CreateSlaPolicyResult } from './sla-policy.service';
import type { SlaPolicyRow } from './sla-policy.repository';

/**
 * FR-104 — SLA policy admin endpoints (`/api/v1/admin/sla-policies`). Both are
 * protected by the global `JwtAuthGuard` + `AbacGuard` via
 * `@Requires('configuration')`; the guard binds the caller's effective scope to
 * the request, which the service reads to enforce scope-A-only creation. The
 * global interceptor wraps every return in the `{ data, meta, error }` envelope.
 */
@Controller('admin/sla-policies')
@Requires(Capability.CONFIGURATION)
export class SlaPolicyController {
  constructor(private readonly service: SlaPolicyService) {}

  // `sla_policies` is org-scoped config (auth-matrix `"scoped": false`), so the
  // explicit resolver fixes the ABAC resource type for the decision/audit; no
  // per-row branch/owner predicate filtering is applied for this table.
  @Get()
  @Requires(Capability.CONFIGURATION, () => ({ resourceType: 'sla_policies' }))
  async list(
    @Query(new ZodValidationPipe(ListSlaPoliciesQueryDto)) query: ListSlaPoliciesQueryDto,
  ): Promise<PaginatedResult<SlaPolicyRow[]>> {
    const result = await this.service.list(query);
    return paginated(result.data, result.pagination);
  }

  @Post()
  @HttpCode(201)
  @Requires(Capability.CONFIGURATION, () => ({ resourceType: 'sla_policies' }))
  async create(
    @Body(new ZodValidationPipe(CreateSlaPolicyDto)) dto: CreateSlaPolicyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<CreateSlaPolicyResult> {
    return this.service.create(dto, user, req[EFFECTIVE_SCOPE_KEY]);
  }
}
