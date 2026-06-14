import { Controller, Get, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  MASKING_LEVEL_KEY,
  Requires,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { SearchQuerySchema, type SearchQueryDto } from './dto/search-query.dto';
import { SearchService, type SearchResult } from './search.service';

/** Pins the ABAC resource explicitly — never rely on the implicit default. */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

export interface SearchResponse extends SearchResult {
  top_n: number;
  query: string;
  counts: { leads: number; partners: number; tasks: number };
}

/**
 * FR-054 — `GET /search` (api-contract `globalSearch`): global masked,
 * scope-filtered search across leads, partners, and tasks.
 *
 * Auth: global `JwtAuthGuard` (401) + `AbacGuard` + `@Requires('view_lead')`.
 * Rate limit: 300 reads/min per user (reads tier, Redis throttle).
 * Validation: `q` required, min 2 chars, max 100 chars (Zod via `SearchQueryDto`).
 * No writes; no AuditAppender; no UnitOfWork.
 */
@Controller('search')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** GET /api/v1/search?q= — top-5 per entity type, masked, scope-filtered. */
  @Get()
  @Requires(Capability.VIEW_LEAD, leadsResource)
  async search(
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: SearchQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<SearchResponse> {
    const predicate = req[SCOPE_PREDICATE_KEY];
    const maskingLevel = req[MASKING_LEVEL_KEY];

    const result = await this.searchService.search(query.q, user, predicate, maskingLevel);

    return {
      ...result,
      top_n: this.searchService.topN,
      query: query.q,
      counts: {
        leads: result.leads.length,
        partners: result.partners.length,
        tasks: result.tasks.length,
      },
    };
  }
}
