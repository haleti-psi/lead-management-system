import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  EFFECTIVE_SCOPE_KEY,
  Requires,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { PaginationParams, ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import type { AssignOwnerResult } from '../capture/lead.service';
import { ALLOCATION_RULES_RESOURCE_TYPE } from './allocation.constants';
import {
  AllocationService,
  type AllocationRuleView,
} from './allocation.service';
import { CreateAllocationRuleDto } from './dto/create-allocation-rule.dto';
import { ReassignLeadDto } from './dto/reassign-lead.dto';

/** Pins the ABAC resource for the reassign endpoint (explicit — never the default). */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });
/** Pins the ABAC resource for the rule admin endpoints (auth-matrix `allocation_rules`). */
const allocationRulesResource = () => ({ resourceType: ALLOCATION_RULES_RESOURCE_TYPE });

/**
 * FR-030 — manual reassignment + allocation-rule administration
 * (api-contract `reassignLead`, FR-030 coverage `GET/POST
 * /admin/allocation-rules`). FR-030 is the SOLE owner of these routes: FR-131's
 * generic `/admin/{masterResource}` allow-list excludes `allocation-rules`
 * (master.constants.ts), so there is no route collision.
 *
 * Every handler runs behind the global `JwtAuthGuard` (401) + `AbacGuard` via
 * `@Requires('allocate', …)` with an explicit scope resolver — BM=B, SM=T,
 * HEAD=A per auth-matrix; RM/others lack the capability (403). Row-level scope
 * (lead and target owner inside the caller's branch/team) is enforced in the
 * service against the guard's resolved predicate. The mutation throttle tier
 * (60/min, environment-contract `RATE_LIMIT_MUTATION` default) overrides the
 * stricter global auth tier.
 */
@Controller()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AllocationController {
  constructor(private readonly service: AllocationService) {}

  /** POST /api/v1/leads/{id}/reassign — manual reassign with auditable reason (200). */
  @Post('leads/:id/reassign')
  @HttpCode(200)
  @Requires(Capability.ALLOCATE, leadsResource)
  async reassignLead(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(ReassignLeadDto)) dto: ReassignLeadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<AssignOwnerResult> {
    return this.service.reassign(id, dto, user, {
      effectiveScope: req[EFFECTIVE_SCOPE_KEY],
      predicate: req[SCOPE_PREDICATE_KEY],
    });
  }

  /** GET /api/v1/admin/allocation-rules — paginated rule list (page/limit ≤ 100). */
  @Get('admin/allocation-rules')
  @Requires(Capability.ALLOCATE, allocationRulesResource)
  async listRules(
    @Query(new ZodValidationPipe(PaginationParams)) query: PaginationParams,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<AllocationRuleView[]>> {
    const result = await this.service.listRules(query, user);
    return paginated(result.data, result.pagination);
  }

  /** POST /api/v1/admin/allocation-rules — create a rule (201; priority clash → 409). */
  @Post('admin/allocation-rules')
  @HttpCode(201)
  @Requires(Capability.ALLOCATE, allocationRulesResource)
  async createRule(
    @Body(new ZodValidationPipe(CreateAllocationRuleDto)) dto: CreateAllocationRuleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AllocationRuleView> {
    return this.service.createRule(dto, user);
  }
}
