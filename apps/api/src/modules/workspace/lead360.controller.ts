import { Controller, Get, Param, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { scopeContext } from './lead-list.controller';
import { Lead360Service } from './lead360.service';
import { Lead360ParamsSchema, type Lead360Dto, type Lead360Params } from './dto/lead360.dto';

/** Pins the ABAC resource explicitly (never rely on the implicit default). */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-051 — `GET /leads/{id}` (api-contract `getLead`): the masked Lead-360
 * aggregate. Runs behind the global `JwtAuthGuard` (401 AUTH_REQUIRED) +
 * `AbacGuard` under `@Requires('view_lead')` (RM=O, SM=T, BM=B, HEAD=A, KYC=B,
 * DPO=M masked, PARTNER=P own submissions). The resolved scope predicate is
 * compiled into the repository SQL, so an out-of-scope lead returns 404
 * NOT_FOUND (existence hidden). Read-tier throttle (300/min) per the
 * environment-contract defaults, matching FR-050's list.
 */
@Controller('leads')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class Lead360Controller {
  constructor(private readonly lead360: Lead360Service) {}

  /** GET /api/v1/leads/:id — scope-checked, masked Lead-360 aggregate (200). */
  @Get(':id')
  @Requires(Capability.VIEW_LEAD, leadsResource)
  async getLead(
    @Param(new ZodValidationPipe(Lead360ParamsSchema)) params: Lead360Params,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<Lead360Dto> {
    return this.lead360.getAggregate(user, params.id, scopeContext(req));
  }
}
