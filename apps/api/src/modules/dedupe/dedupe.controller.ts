import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
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
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { DuplicateService } from './dedupe.service';
import { DuplicateCheckDto } from './dto/duplicate-check.dto';
import type { DuplicateCheckResponseDto } from './dto/duplicate-match.dto';

/** Pins the ABAC resource for the duplicate-check endpoint (explicit — never the default). */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-020 — `POST /api/v1/leads/{id}/duplicate-check` (api-contract
 * `duplicateCheck`, the module's single contracted endpoint). Protected by the
 * global `JwtAuthGuard` (401) + `AbacGuard` via `@Requires('edit_lead', …)`
 * with an explicit scope resolver; row-level scope (RM=O, SM=T, BM/KYC=B,
 * HEAD=A) is enforced in the service against the guard's resolved predicate.
 * The mutation throttle tier (60/min, environment-contract
 * `RATE_LIMIT_MUTATION` default) overrides the stricter global auth tier.
 */
@Controller()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class DedupeController {
  constructor(private readonly duplicates: DuplicateService) {}

  /** Run/re-run duplicate detection (200 with match list; 409 on strong block). */
  @Post('leads/:id/duplicate-check')
  @HttpCode(200)
  @Requires(Capability.EDIT_LEAD, leadsResource)
  async check(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(DuplicateCheckDto)) dto: DuplicateCheckDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<DuplicateCheckResponseDto> {
    return this.duplicates.check(id, dto, user, { predicate: req[SCOPE_PREDICATE_KEY] });
  }
}
