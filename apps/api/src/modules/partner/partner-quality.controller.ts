import { Controller, Get, Param, Query, Req } from '@nestjs/common';
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
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { PartnerQualityQuerySchema, type PartnerQualityQuery } from './dto/partner-quality-query.dto';
import { PARTNER_RESOURCE_TYPE } from './partner.constants';
import { PartnerQualityService, type PartnerQualityData } from './partner-quality.service';

const partnerResource = () => ({ resourceType: PARTNER_RESOURCE_TYPE });

/**
 * FR-092 — partner quality score & dashboard (api-contract `partnerQuality`).
 * Global `JwtAuthGuard` (401) + `AbacGuard` via `@Requires('reports')`; the
 * service enforces the partner scope (PARTNER own / BM branch / SM team / HEAD
 * org; RM `own`-predicate → FORBIDDEN). Read throttle tier (300/min).
 */
@Controller('partners')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class PartnerQualityController {
  constructor(private readonly quality: PartnerQualityService) {}

  /** GET /api/v1/partners/{id}/quality — computed quality score + factor breakdown (200). */
  @Get(':id/quality')
  @Requires(Capability.REPORTS, partnerResource)
  async partnerQuality(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Query(new ZodValidationPipe(PartnerQualityQuerySchema)) query: PartnerQualityQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PartnerQualityData> {
    return this.quality.compute(
      { userId: user.userId, orgId: user.orgId, predicate: req[SCOPE_PREDICATE_KEY] },
      id,
      query,
    );
  }
}
