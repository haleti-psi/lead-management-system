import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { CreateSchemeDto } from './dto/create-scheme.dto';
import { ListSchemesQueryDto } from './dto/list-schemes.dto';
import { SCHEME_RESOURCE_TYPE } from './scheme.constants';
import { SchemeService } from './scheme.service';
import type { SchemeRow } from './scheme.repository';

/** Fixes the ABAC resource type for `schemes` (auth-matrix `scoped:false`). */
const schemeResource = () => ({ resourceType: SCHEME_RESOURCE_TYPE });

/**
 * FR-042 — scheme administration endpoints (`/api/v1/admin/schemes`). FR-042 is
 * the SOLE owner of these routes; FR-131's generic `/admin/{masterResource}`
 * allow-list deliberately excludes `schemes` (see master.constants.ts), so there
 * is no route collision. Both handlers are protected by the global `JwtAuthGuard`
 * + `AbacGuard` via `@Requires('configuration')`; `schemes` is org-scoped config
 * (auth-matrix `scoped:false`), so the resolver pins the ABAC resource type and
 * the service enforces the scope-A (ADMIN/HEAD) floor for creation. The global
 * interceptor wraps each return in the `{ data, meta, error }` envelope.
 *
 * Scheme deactivation/edit is out of scope for FR-042 (LLD §Ambiguities #4) — no
 * PATCH/DELETE here. Attaching a scheme to a lead is performed by the lead-capture
 * FR through `PATCH /leads/{id}`, which consumes
 * {@link SchemeService.validateAndResolveScheme}.
 */
@Controller('admin/schemes')
@Requires(Capability.CONFIGURATION)
export class SchemeController {
  constructor(private readonly service: SchemeService) {}

  @Get()
  @Requires(Capability.CONFIGURATION, schemeResource)
  async list(
    @Query(new ZodValidationPipe(ListSchemesQueryDto)) query: ListSchemesQueryDto,
  ): Promise<PaginatedResult<SchemeRow[]>> {
    const result = await this.service.list(query);
    return paginated(result.data, result.pagination);
  }

  @Post()
  @HttpCode(201)
  @Requires(Capability.CONFIGURATION, schemeResource)
  async create(
    @Body(new ZodValidationPipe(CreateSchemeDto)) dto: CreateSchemeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<SchemeRow> {
    return this.service.create(dto, user, req[EFFECTIVE_SCOPE_KEY]);
  }
}
