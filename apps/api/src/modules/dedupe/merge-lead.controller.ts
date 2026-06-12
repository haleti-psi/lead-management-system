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
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { MergeLeadDto, type MergeLeadResponseDto } from './dto/merge-lead.dto';
import { UnmergeLeadDto, type UnmergeLeadResponseDto } from './dto/unmerge-lead.dto';
import { MergeLeadService } from './merge-lead.service';

/** Pins the ABAC resource for the merge endpoints (explicit — never the default). */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-021 — `POST /api/v1/leads/{id}/merge` (api-contract `mergeLead`) and its
 * companion `POST /api/v1/leads/{id}/unmerge` (LLD §Endpoints; same
 * x-frs: [FR-021]). Protected by the global `JwtAuthGuard` (401) + `AbacGuard`
 * via `@Requires('edit_lead', …)` with an explicit scope resolver; the
 * BM/SM-only rule and the row-level scope over BOTH leads are enforced in the
 * service against the guard's resolved predicate. The mutation throttle tier
 * (60/min, environment-contract `RATE_LIMIT_MUTATION` default) overrides the
 * stricter global auth tier (T-027).
 */
@Controller()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class MergeLeadController {
  constructor(private readonly merges: MergeLeadService) {}

  /** Merge the duplicate at `{id}` into the body's master (200 with relink counts). */
  @Post('leads/:id/merge')
  @HttpCode(200)
  @Requires(Capability.EDIT_LEAD, leadsResource)
  async merge(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(MergeLeadDto)) dto: MergeLeadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<MergeLeadResponseDto> {
    return this.merges.merge(id, dto, user, { predicate: req[SCOPE_PREDICATE_KEY] });
  }

  /** Reverse a merge of the lead at `{id}` within the unmerge window (200 with restore counts). */
  @Post('leads/:id/unmerge')
  @HttpCode(200)
  @Requires(Capability.EDIT_LEAD, leadsResource)
  async unmerge(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UnmergeLeadDto)) dto: UnmergeLeadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<UnmergeLeadResponseDto> {
    return this.merges.unmerge(id, dto, user, { predicate: req[SCOPE_PREDICATE_KEY] });
  }
}
