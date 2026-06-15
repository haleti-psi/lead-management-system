import { Controller, Headers, Param, Post, Req } from '@nestjs/common';

import { Capability, ERROR_CODES } from '@lms/shared';

import { CurrentUser, Requires, type AuthUser } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import type { AbacRequestContext } from '../../core/auth/abac-context';
import { DomainException, getCorrelationId } from '../../core/http';
import type { CorrelatedRequest } from '../../core/http/correlation.middleware';
import { HandoffPathSchema, HandoffIdempotencyKeySchema } from './dto/handoff.dto';
import { LosHandoffService } from './los-handoff.service';

/**
 * FR-081 — LOS Hand-off controller.
 *
 * POST /api/v1/leads/:id/handoff — initiates the guarded, idempotent LOS
 * hand-off for a ready_for_handoff lead. Protected by JwtAuthGuard (global) +
 * AbacGuard @Requires('hand_off', scopeResolver).
 */
@Controller('leads')
export class LosHandoffController {
  constructor(private readonly handoffService: LosHandoffService) {}

  /**
   * POST /leads/:id/handoff
   *
   * Auth: JwtAuthGuard (global) + @Requires('hand_off') with an explicit scope
   * resolver that resolves the lead's owner/branch so ABAC can enforce:
   *   BM  → scope B (branch_id match)
   *   KYC → scope B
   *   RM  → scope O (owner_id match; configurable delegation OD-03)
   *   DPO → scope M (masked read; capability present)
   *
   * Idempotency-Key is required (unlike FR-080 where it is optional).
   */
  @Post(':id/handoff')
  @Requires(Capability.HAND_OFF, (req: AbacRequestContext) => ({
    resourceType: 'leads',
    resourceId: (req as unknown as { params?: { id?: string } }).params?.id,
  }))
  async handoffToLos(
    @Param('id', new ZodValidationPipe(HandoffPathSchema.shape.id)) leadId: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Req() req: AbacRequestContext,
  ): Promise<unknown> {
    // Validate required Idempotency-Key header.
    if (!rawIdempotencyKey) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: 'Idempotency-Key', issue: 'Idempotency-Key header is required' }],
      });
    }

    const parsed = HandoffIdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsed.success) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: 'Idempotency-Key', issue: parsed.error.issues[0]?.message ?? 'invalid' }],
      });
    }
    const idempotencyKey = parsed.data;

    const correlationId = getCorrelationId(req as CorrelatedRequest) ?? 'corr_system';

    const result = await this.handoffService.handoffToLos(leadId, user, idempotencyKey, correlationId);

    const responseData = {
      leadId: result.leadId,
      stage: result.stage,
      losApplicationId: result.losApplicationId,
      handedOffAt: result.handedOffAt,
    };

    if (result.idempotentReplay) {
      // Return full envelope so we can set meta.reason = IDEMPOTENT_REPLAY.
      return {
        data: responseData,
        meta: { correlation_id: correlationId, reason: 'IDEMPOTENT_REPLAY' },
        error: null,
      };
    }

    // Normal path: ResponseEnvelopeInterceptor wraps in { data, meta, error }.
    return responseData;
  }
}
