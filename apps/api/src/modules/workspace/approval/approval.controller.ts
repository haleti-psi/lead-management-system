import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires, type AuthUser } from '../../../core/auth';
import { ZodValidationPipe } from '../../../core/common';
import { LEADS_RESOURCE_TYPE } from '../../capture/capture.constants';
import { ApprovalDto } from './dto/approval.dto';
import { ApprovalService, type ApprovalResult } from './approval.service';
import { UuidParam } from '../../admin/dto/uuid-param.dto';

/**
 * Explicit leads resource resolver for approve_lead (mirrors the FR-030 reassign
 * and FR-052 move_stage patterns — the scope predicate is resolved by AbacGuard
 * against the lead's branch/team/owner fields; row-level scope is re-checked
 * inside the service against the loaded lead row).
 */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-055 — `POST /leads/:id/approval` (lead-approval gate).
 *
 * Auth: global `JwtAuthGuard` (401) + `AbacGuard` with
 * `@Requires(Capability.APPROVE_LEAD)`. Roles: BM (B scope), SM (T scope),
 * HEAD (A scope). RM and PARTNER do NOT hold `approve_lead` → 403.
 * Rate: 60/min (mutation tier).
 */
@Controller('leads')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  /**
   * POST /api/v1/leads/:id/approval — decide approve or reject.
   *
   * Body: `{ decision: 'approve'|'reject', reason?: string }`
   * Success 200: `{ data: { lead_id, lead_code, stage, approval_status, decision, decided_by, decided_at } }`
   * Returns the raw object; `ResponseEnvelopeInterceptor` wraps it in `{ data, meta, error }`.
   */
  @Post(':id/approval')
  @HttpCode(200)
  @Requires(Capability.APPROVE_LEAD, leadsResource)
  async decide(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(ApprovalDto)) dto: ApprovalDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApprovalResult> {
    return this.approvalService.decide(id, dto, user);
  }
}
