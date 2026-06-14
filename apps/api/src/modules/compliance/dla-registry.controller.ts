import { Body, Controller, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { DLA_REGISTRY_RESOURCE_TYPE } from './dla-registry.constants';
import {
  DlaRegistryService,
  type DlaActorContext,
  type DlaListResult,
} from './dla-registry.service';
import type { DlaData } from './dla-registry.repository';
import { CreateDlaDto } from './dto/create-dla.dto';
import { UpdateDlaDto } from './dto/update-dla.dto';
import { ListDlaFiltersDto } from './dto/list-dla-filters.dto';

/**
 * ABAC resource resolver for all DLA registry endpoints.
 * `dla_registry` is org-scoped (not lead-scoped); no owner/branch resolution needed.
 */
const dlaRegistryResource = () => ({ resourceType: DLA_REGISTRY_RESOURCE_TYPE });

/**
 * FR-113 — DLA/LSP Registry endpoints (api-contract `listDla` / `createDla` /
 * `updateDla`). All run behind the global `JwtAuthGuard` (401) + `AbacGuard`
 * via `@Requires('configuration', …)`.
 *
 * Explicit role enforcement (DPO/ADMIN only) is delegated to the service layer via
 * `DlaRegistryService.assertAllowedRole`. The `configuration` capability is held by
 * more roles than DPO and ADMIN (BM, HEAD, KYC per auth-matrix); the service-layer
 * check is the decisive gate (recurring bug class — capability alone is insufficient).
 *
 * Throttle tiers: mutations 60/min, reads 300/min.
 */
@Controller('compliance/dla')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class DlaRegistryController {
  constructor(private readonly dlaRegistry: DlaRegistryService) {}

  /**
   * GET /api/v1/compliance/dla — paginated, org-scoped DLA/LSP registry list (200).
   * Optionally filtered by `type` and `status`.
   */
  @Get()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Requires(Capability.CONFIGURATION, dlaRegistryResource)
  async listDla(
    @Query(new ZodValidationPipe(ListDlaFiltersDto)) query: ListDlaFiltersDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<DlaData[]>> {
    const result: DlaListResult = await this.dlaRegistry.list(
      query,
      actorCtx(user),
      user.role,
    );
    return paginated(result.data, result.pagination);
  }

  /**
   * POST /api/v1/compliance/dla — create a new DLA/LSP registry entry (201).
   */
  @Post()
  @HttpCode(201)
  @Requires(Capability.CONFIGURATION, dlaRegistryResource)
  async createDla(
    @Body(new ZodValidationPipe(CreateDlaDto)) dto: CreateDlaDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DlaData> {
    return this.dlaRegistry.create(dto, actorCtx(user), user.role);
  }

  /**
   * PATCH /api/v1/compliance/dla — update an existing DLA/LSP registry entry (200).
   * The `dla_registry_id` is in the request body (no `{id}` path segment per
   * api-contract.yaml — see LLD Ambiguity #1).
   */
  @Patch()
  @Requires(Capability.CONFIGURATION, dlaRegistryResource)
  async updateDla(
    @Body(new ZodValidationPipe(UpdateDlaDto)) dto: UpdateDlaDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DlaData> {
    return this.dlaRegistry.update(dto, actorCtx(user), user.role);
  }
}

/** Build the service actor context from the authenticated user principal. */
function actorCtx(user: AuthUser): DlaActorContext {
  return {
    callerId: user.userId,
    orgId: user.orgId,
  };
}
