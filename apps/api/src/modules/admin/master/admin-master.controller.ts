import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../../core/auth';
import type { AuthUser } from '../../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../../core/auth';
import { ZodValidationPipe } from '../../../core/common';
import { paginated, type PaginatedResult } from '../../../core/http';
import { UuidParam } from '../dto/uuid-param.dto';
import { MASTER_RESOURCE_ROUTE, MASTER_RESOURCE_TYPE } from './master.constants';
import {
  AdminMasterService,
  type MutateMasterResult,
} from './admin-master.service';
import { ListMasterQuery } from './dto/list-master-query.dto';
import { MasterResourceRegistry } from './master-resource.registry';
import type { MasterRecordView } from './master-resource.types';

/** Pins the ABAC resource type for every master handler (auth-matrix `scoped:false`). */
const masterResource = () => ({ resourceType: MASTER_RESOURCE_TYPE });

/**
 * FR-131 — generic master/config CRUD under `/api/v1/admin/{masterResource}`.
 *
 * Route-ownership: this handler serves ONLY the allow-listed master resources in
 * {@link MasterResourceRegistry} (regions, branches, partners, schemes,
 * rejection-reasons, allocation-rules, business-calendars,
 * communication-templates, dla-registry, retention-policies). Resources owned by
 * another FR with its own concrete controller are NOT in the allow-list and are
 * never handled here — users/roles/teams (FR-130), products (FR-040),
 * sla-policies (FR-104), webhooks/integrations (FR-140), break-glass (FR-003).
 * An unknown/disallowed `{masterResource}` resolves to VALIDATION_ERROR (400,
 * field `masterResource`) per the LLD (T05/T30).
 *
 * All handlers run behind the global `JwtAuthGuard` + `AbacGuard` via
 * `@Requires('configuration')`; the service enforces the scope-A (ADMIN/HEAD)
 * floor for every mutation. The global interceptor wraps returns in the uniform
 * `{ data, meta, error }` envelope; the global throttler applies the mutation
 * tier (60/min/user).
 */
@Controller('admin')
@Requires(Capability.CONFIGURATION)
export class AdminMasterController {
  constructor(
    private readonly registry: MasterResourceRegistry,
    private readonly service: AdminMasterService,
  ) {}

  @Get(MASTER_RESOURCE_ROUTE)
  @Requires(Capability.CONFIGURATION, masterResource)
  async list(
    @Param('masterResource') slug: string,
    @Query(new ZodValidationPipe(ListMasterQuery)) query: ListMasterQuery,
  ): Promise<PaginatedResult<MasterRecordView[]>> {
    const descriptor = this.registry.resolve(slug);
    const result = await this.service.list(descriptor, {
      page: query.page,
      limit: query.limit,
      isActive: query.isActive,
    });
    return paginated(result.data, result.pagination);
  }

  @Post(MASTER_RESOURCE_ROUTE)
  @HttpCode(201)
  @Requires(Capability.CONFIGURATION, masterResource)
  async create(
    @Param('masterResource') slug: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<MasterCreateResponse> {
    const descriptor = this.registry.resolve(slug);
    const dto = new ZodValidationPipe(descriptor.createSchema).transform(rawBody);
    const result = await this.service.create(descriptor, dto, user, req[EFFECTIVE_SCOPE_KEY]);
    return toCreateResponse(result);
  }

  @Patch(`${MASTER_RESOURCE_ROUTE}/:id`)
  @Requires(Capability.CONFIGURATION, masterResource)
  async update(
    @Param('masterResource') slug: string,
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<MasterRecordView & { configVersionId: string }> {
    const descriptor = this.registry.resolve(slug);
    const dto = new ZodValidationPipe(descriptor.patchSchema).transform(rawBody);
    const result = await this.service.update(descriptor, id, dto, user, req[EFFECTIVE_SCOPE_KEY]);
    return { ...result.record, configVersionId: result.configVersionId };
  }
}

/** POST returns the created record fields plus the maker-checker `configVersionId`. */
type MasterCreateResponse = MasterRecordView & { configVersionId: string };

function toCreateResponse(result: MutateMasterResult): MasterCreateResponse {
  return { ...result.record, configVersionId: result.configVersionId };
}
