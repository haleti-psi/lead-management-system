import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
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
import { SAVED_VIEWS_RESOURCE_TYPE } from './workspace.constants';
import { SavedViewService, type SavedViewView } from './saved-view.service';
import type { WorkspaceScopeContext } from './lead-list.service';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';

/** Pins the ABAC resource for the saved-view endpoints (auth-matrix `saved_views`). */
const savedViewsResource = () => ({ resourceType: SAVED_VIEWS_RESOURCE_TYPE });

/**
 * FR-050 — `GET/POST /saved-views` (api-contract `listSavedViews` /
 * `createSavedView`). Behind the global `JwtAuthGuard` (401) + `AbacGuard`
 * `@Requires('view_lead', …)`: any role holding `view_lead` may list/create —
 * visibility (own ∪ in-scope shared) is a SQL predicate, never a 403 (LLD
 * §Endpoint 2). Reads ride the 300/min read tier; create uses the mutation tier.
 */
@Controller('saved-views')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class SavedViewController {
  constructor(private readonly service: SavedViewService) {}

  /** GET /api/v1/saved-views — own ∪ in-scope shared views (200, paginated). */
  @Get()
  @Requires(Capability.VIEW_LEAD, savedViewsResource)
  async listSavedViews(
    @Query(new ZodValidationPipe(PaginationParams)) query: PaginationParams,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<SavedViewView[]>> {
    const result = await this.service.list(user, query, scopeContext(req));
    return paginated(result.data, result.pagination);
  }

  /** POST /api/v1/saved-views — persist a filter preset (201). */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Requires(Capability.VIEW_LEAD, savedViewsResource)
  async createSavedView(
    @Body(new ZodValidationPipe(CreateSavedViewDto)) dto: CreateSavedViewDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<SavedViewView> {
    return this.service.create(user, dto, scopeContext(req));
  }
}

/** Lift the AbacGuard grant outputs off the request for the service. */
function scopeContext(req: AbacRequestContext): WorkspaceScopeContext {
  return {
    effectiveScope: req[EFFECTIVE_SCOPE_KEY],
    predicate: req[SCOPE_PREDICATE_KEY],
  };
}
