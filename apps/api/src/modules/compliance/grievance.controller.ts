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
import { GRIEVANCES_RESOURCE_TYPE } from './grievance.constants';
import { GrievanceIdempotencyService } from './grievance-idempotency.service';
import {
  GrievanceService,
  type GrievanceActorContext,
  type GrievanceData,
} from './grievance.service';
import { CreateGrievanceDto } from './dto/create-grievance.dto';
import { UpdateGrievanceDto } from './dto/update-grievance.dto';
import { ListGrievancesQuery } from './dto/list-grievances.dto';

/** ABAC resource resolver for all grievance endpoints. */
const grievancesResource = () => ({ resourceType: GRIEVANCES_RESOURCE_TYPE });

/**
 * FR-114 — Staff grievance endpoints (api-contract `listGrievances` /
 * `createGrievance` / `updateGrievance`). All run behind the global
 * `JwtAuthGuard` (401) + `AbacGuard` via `@Requires('consent_ledger', …)`.
 *
 * Throttle tiers: mutations 60/min, reads 300/min (environment-contract defaults).
 *
 * The `POST /grievances` handler delegates to `GrievanceService.create(dto, ctx)`,
 * which is also called by FR-061's self-service handler with `source='customer_link'`
 * — the service is not coupled to the HTTP request shape.
 */
@Controller('grievances')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GrievanceController {
  constructor(
    private readonly grievances: GrievanceService,
    private readonly idempotency: GrievanceIdempotencyService,
  ) {}

  /** GET /api/v1/grievances — paginated, scope-filtered list (200). */
  @Get()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Requires(Capability.CONSENT_LEDGER, grievancesResource)
  async listGrievances(
    @Query(new ZodValidationPipe(ListGrievancesQuery)) query: ListGrievancesQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<GrievanceData[]>> {
    const result = await this.grievances.list(query, actorContext(user, req));
    return paginated(result.data, result.pagination);
  }

  /** POST /api/v1/grievances — create grievance (internal intake) (201). */
  @Post()
  @HttpCode(201)
  @Requires(Capability.CONSENT_LEDGER, grievancesResource)
  async createGrievance(
    @Body(new ZodValidationPipe(CreateGrievanceDto)) dto: CreateGrievanceDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
    @Res({ passthrough: true }) res: HttpResponseLike,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<GrievanceData> {
    if (idempotencyKey) {
      const cached = await this.idempotency.get<GrievanceData>(idempotencyKey);
      if (cached) {
        // Transparent Idempotency-Key replay → 200 with the ORIGINAL payload
        // (error stays null; taxonomy sub-reason IDEMPOTENT_REPLAY).
        res.status(200);
        return cached;
      }
    }

    const result = await this.grievances.create(dto, actorContext(user, req));

    if (idempotencyKey) {
      await this.idempotency.set(idempotencyKey, result);
    }

    return result;
  }

  /** PATCH /api/v1/grievances/{id} — update / resolve / close grievance (200). */
  @Patch(':id')
  @Requires(Capability.CONSENT_LEDGER, grievancesResource)
  async updateGrievance(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdateGrievanceDto)) dto: UpdateGrievanceDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<GrievanceData> {
    return this.grievances.update(id, dto, actorContext(user, req));
  }
}

/** Build the service actor context from the authenticated request. */
function actorContext(user: AuthUser, req: AbacRequestContext): GrievanceActorContext {
  return {
    callerId: user.userId,
    orgId: user.orgId,
    predicate: req[SCOPE_PREDICATE_KEY],
    // branchId is not in the JWT claims (AuthUser); SLA resolution falls back to
    // the lead's branch (resolved in GrievanceService.create when leadId is set).
    branchId: null,
  };
}
