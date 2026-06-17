import { Controller, Get, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { LeadListService, type BoardCardItem, type DashboardMetricsResult } from './lead-list.service';
import { scopeContext } from './lead-list.controller';
import { BoardColumnQuerySchema, type BoardColumnQuery } from './dto/list-leads.dto';

/** Pins the ABAC resource explicitly (never rely on the implicit default). */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-052 — `GET /api/v1/pipeline-board?stage=<stage>`: one masked, scope-filtered
 * Kanban column with the board projection (requested amount, owner name, ageing,
 * optimistic-lock version). Behind the global `JwtAuthGuard` (401) + `AbacGuard`
 * `@Requires('view_lead')` (RM=O, SM=T, BM=B, HEAD=A, DPO=masked; PARTNER/CUSTOMER
 * denied). 300/min read tier. Lives at its own path — not `/leads/board` — to
 * avoid colliding with the `/leads/:id` (Lead-360) param route.
 */
@Controller('pipeline-board')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class PipelineBoardReadController {
  constructor(private readonly list: LeadListService) {}

  @Get()
  @Requires(Capability.VIEW_LEAD, leadsResource)
  async board(
    @Query(new ZodValidationPipe(BoardColumnQuerySchema)) query: BoardColumnQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<BoardCardItem[]>> {
    const result = await this.list.boardColumn(user, query, scopeContext(req));
    return paginated(result.data, result.pagination);
  }

  /** GET /api/v1/pipeline-board/trends — scoped pipeline value + 14-day captures series. */
  @Get('trends')
  @Requires(Capability.VIEW_LEAD, leadsResource)
  async trends(
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<DashboardMetricsResult> {
    return this.list.dashboardMetrics(user, scopeContext(req));
  }
}
