import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  EFFECTIVE_SCOPE_KEY,
  MASKING_LEVEL_KEY,
  Requires,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { BulkActionService, type BulkActionResult } from './bulk-action.service';
import { LeadListService, type LeadListItem, type WorkspaceScopeContext } from './lead-list.service';
import { BulkActionDto } from './dto/bulk-action.dto';
import { ListLeadsQuerySchema, type ListLeadsQuery } from './dto/list-leads.dto';

/** Pins the ABAC resource explicitly (never rely on the implicit default). */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-050 — `GET /leads` (api-contract `listLeads`) and `POST /leads/bulk-action`
 * (`leadsBulkAction`). Both run behind the global `JwtAuthGuard` (401) +
 * `AbacGuard`: the list under `@Requires('view_lead')` (RM=O, SM=T, BM=B,
 * HEAD=A, DPO=M masked; PARTNER/CUSTOMER denied downstream), the bulk gate
 * under `@Requires('bulk_action')` (SM=T, BM=B, KYC=B, HEAD=A — RM has none →
 * 403). Reads use the 300/min read throttle tier; the bulk mutation overrides
 * to the 60/min mutation tier (environment-contract defaults).
 */
@Controller('leads')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class LeadListController {
  constructor(
    private readonly list: LeadListService,
    private readonly bulk: BulkActionService,
  ) {}

  /** GET /api/v1/leads — scope-filtered, masked, paginated lead list (200). */
  @Get()
  @Requires(Capability.VIEW_LEAD, leadsResource)
  async listLeads(
    @Query(new ZodValidationPipe(ListLeadsQuerySchema)) query: ListLeadsQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<LeadListItem[]>> {
    const result = await this.list.list(user, query, scopeContext(req));
    return paginated(result.data, result.pagination);
  }

  /** POST /api/v1/leads/bulk-action — scoped bulk dispatch via LeadService (200). */
  @Post('bulk-action')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Requires(Capability.BULK_ACTION, leadsResource)
  async bulkAction(
    @Body(new ZodValidationPipe(BulkActionDto)) dto: BulkActionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<BulkActionResult> {
    return this.bulk.execute(user, dto, scopeContext(req));
  }
}

/** Lift the AbacGuard grant outputs off the request for the services
 *  (shared by the workspace controllers — FR-050 list/bulk, FR-051 lead-360). */
export function scopeContext(req: AbacRequestContext): WorkspaceScopeContext {
  return {
    effectiveScope: req[EFFECTIVE_SCOPE_KEY],
    predicate: req[SCOPE_PREDICATE_KEY],
    maskingLevel: req[MASKING_LEVEL_KEY],
  };
}
