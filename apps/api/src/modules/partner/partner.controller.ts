import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
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
import { paginated, type PaginatedResult } from '../../core/http';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { ListPartnersQuerySchema, type ListPartnersQuery } from './dto/list-partners.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { PARTNER_RESOURCE_TYPE } from './partner.constants';
import {
  PartnerService,
  type CreatePartnerView,
  type PartnerActorContext,
  type PartnerView,
  type UpdatePartnerView,
} from './partner.service';

/** Pins the ABAC resource for the partner endpoints (explicit). */
const partnerResource = () => ({ resourceType: PARTNER_RESOURCE_TYPE });

/**
 * FR-090 — Partner master CRUD (api-contract `listPartners`/`createPartner`/
 * `updatePartner`). Global `JwtAuthGuard` (401) + `AbacGuard` via
 * `@Requires('configuration')` (ADMIN/HEAD scope A, BM scope B; others 403). The
 * service enforces branch scope + the ADMIN/HEAD-only status-change rule. Reads
 * use the 300/min tier; writes the 60/min mutation tier.
 */
@Controller('partners')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class PartnerController {
  constructor(private readonly partners: PartnerService) {}

  /** GET /api/v1/partners — scope-filtered, paginated partner list (200). */
  @Get()
  @Requires(Capability.CONFIGURATION, partnerResource)
  async listPartners(
    @Query(new ZodValidationPipe(ListPartnersQuerySchema)) query: ListPartnersQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<PartnerView[]>> {
    const result = await this.partners.list(query, ctx(user, req));
    return paginated(result.data, result.pagination);
  }

  /** POST /api/v1/partners — create a partner (201). */
  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Requires(Capability.CONFIGURATION, partnerResource)
  async createPartner(
    @Body(new ZodValidationPipe(CreatePartnerDto)) dto: CreatePartnerDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<CreatePartnerView> {
    return this.partners.create(dto, ctx(user, req));
  }

  /** PATCH /api/v1/partners/{id} — update metadata / change status (200). */
  @Patch(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Requires(Capability.CONFIGURATION, partnerResource)
  async updatePartner(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdatePartnerDto)) dto: UpdatePartnerDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<UpdatePartnerView> {
    return this.partners.update(id, dto, ctx(user, req));
  }
}

function ctx(user: AuthUser, req: AbacRequestContext): PartnerActorContext {
  return { userId: user.userId, orgId: user.orgId, role: user.role, predicate: req[SCOPE_PREDICATE_KEY] };
}
