import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type HttpResponseLike, type PaginatedResult } from '../../core/http';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { DATA_RIGHTS_RESOURCE_TYPE } from './data-rights.constants';
import { DataRightsIdempotencyService } from './data-rights-idempotency.service';
import {
  DataRightsService,
  type DataRightsActorContext,
  type DataRightsData,
} from './data-rights.service';
import { CreateDataRightsDto } from './dto/create-data-rights.dto';
import { UpdateDataRightsDto } from './dto/update-data-rights.dto';
import { ListDataRightsQuery } from './dto/list-data-rights.dto';

/** ABAC resource resolver for all data-rights endpoints. */
const dataRightsResource = () => ({ resourceType: DATA_RIGHTS_RESOURCE_TYPE });

/**
 * FR-112 — Data-rights endpoints (api-contract `listDataRights` /
 * `createDataRights` / `processDataRights`). All run behind the global
 * `JwtAuthGuard` (401) + `AbacGuard` via `@Requires('consent_ledger', …)`.
 *
 * The PATCH handler additionally enforces DPO-only at the service layer —
 * `consent_ledger` is held by many roles; the explicit role check in
 * `DataRightsService.assertDpoRole` gates the PATCH to DPO only (LLD §Auth
 * Check Endpoint 3; recurring bug class note in the agent prompt).
 *
 * Throttle tiers: mutations 60/min, reads 300/min.
 */
@Controller('data-rights')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class DataRightsController {
  constructor(
    private readonly dataRights: DataRightsService,
    private readonly idempotency: DataRightsIdempotencyService,
  ) {}

  /** GET /api/v1/data-rights — paginated list (DPO only). 200. */
  @Get()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Requires(Capability.CONSENT_LEDGER, dataRightsResource)
  async listDataRights(
    @Query(new ZodValidationPipe(ListDataRightsQuery)) query: ListDataRightsQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<DataRightsData[]>> {
    const result = await this.dataRights.list(query, actorCtx(user, req), user.role);
    return paginated(result.data, result.pagination);
  }

  /**
   * POST /api/v1/data-rights — raise a data-rights request (DPO only). 201 (or 200 on idempotent replay).
   *
   * The customer self-service path is POST /c/:token/data-rights
   * (CustomerDataRightsController). This staff route is restricted to DPO.
   */
  @Post()
  @HttpCode(201)
  @Requires(Capability.CONSENT_LEDGER, dataRightsResource)
  async createDataRights(
    @Body(new ZodValidationPipe(CreateDataRightsDto)) dto: CreateDataRightsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
    @Res({ passthrough: true }) res: HttpResponseLike,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<DataRightsData> {
    // ── DPO-only — POST /data-rights is restricted to DPO (LLD §Auth Check) ──
    this.dataRights.assertDpoRole(user.role);

    if (idempotencyKey) {
      const cached = await this.idempotency.get<DataRightsData>(idempotencyKey);
      if (cached) {
        // Transparent Idempotency-Key replay → 200 with the original payload.
        // error stays null; taxonomy sub-reason IDEMPOTENT_REPLAY.
        res.status(200);
        return cached;
      }
    }

    const result = await this.dataRights.create(dto, actorCtx(user, req));

    if (idempotencyKey) {
      await this.idempotency.set(idempotencyKey, result);
    }

    return result;
  }

  /**
   * PATCH /api/v1/data-rights/{id} — process a request (DPO only). 200.
   *
   * AbacGuard checks `consent_ledger` capability; the service enforces the
   * DPO-only restriction by inspecting `user.role` explicitly (LLD §Auth Check
   * Endpoint 3; avoids the recurring "capability-alone is insufficient" bug).
   */
  @Patch(':id')
  @Requires(Capability.CONSENT_LEDGER, dataRightsResource)
  async processDataRights(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdateDataRightsDto)) dto: UpdateDataRightsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<DataRightsData> {
    return this.dataRights.process(id, dto, actorCtx(user, req), user.role);
  }
}

/** Build the service actor context from the authenticated request. */
function actorCtx(user: AuthUser, req: AbacRequestContext): DataRightsActorContext {
  return {
    callerId: user.userId,
    orgId: user.orgId,
    predicate: req[SCOPE_PREDICATE_KEY],
  };
}
