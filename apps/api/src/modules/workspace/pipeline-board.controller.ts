import { Body, Controller, HttpCode, Param, Patch, Req } from '@nestjs/common';
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
import { StageTransitionDtoSchema, type StageTransitionDto } from './dto/stage-transition.dto';
import { PipelineBoardService, type StageTransitionResult } from './pipeline-board.service';

/**
 * Explicit leads resource resolver for move_stage (CORRECTIONS.md §FR-052 /
 * LLD §Auth Check): the AbacGuard resolves the scope predicate from the actor's
 * entitlement and the param `id` is not needed for the resource declaration
 * (the row-level scope enforcement happens inside PipelineBoardService against
 * the locked lead row — after the guard has emitted the predicate).
 */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-052 — `PATCH /leads/:id/stage` (stage transition / pipeline-board move).
 *
 * Auth: global `JwtAuthGuard` (401) + `AbacGuard` with `@Requires('move_stage')`.
 * Roles: RM (O scope), BM (B scope), SM (T scope). HEAD has no `move_stage` → 403.
 * Rate: 60/min (mutation tier — override the default 300/min read tier).
 */
@Controller('leads')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PipelineBoardController {
  constructor(private readonly board: PipelineBoardService) {}

  /**
   * PATCH /api/v1/leads/:id/stage — move the lead to the given stage.
   *
   * Body (StageChange contract): `{ to, expected_version, reason? }`
   * Success 200: `{ data: { leadId, leadCode, stage, version, updatedAt } }`
   */
  @Patch(':id/stage')
  @HttpCode(200)
  @Requires(Capability.MOVE_STAGE, leadsResource)
  async transitionStage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StageTransitionDtoSchema)) dto: StageTransitionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<StageTransitionResult> {
    // Return the raw result; ResponseEnvelopeInterceptor wraps it as
    // { data, meta, error }. Returning { data: result } here double-wraps.
    return this.board.transitionStage(id, dto, user, req[SCOPE_PREDICATE_KEY]);
  }
}
