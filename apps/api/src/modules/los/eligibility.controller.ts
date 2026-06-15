import { Controller, Headers, Param, Post, Req } from '@nestjs/common';

import { Capability, ERROR_CODES } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import type { AbacRequestContext } from '../../core/auth/abac-context';
import { DomainException, getCorrelationId } from '../../core/http';
import type { CorrelatedRequest } from '../../core/http/correlation.middleware';
import { IdempotencyKeyHeaderSchema, RequestEligibilityParamSchema } from './dto/request-eligibility.dto';
import { EligibilityService } from './eligibility.service';

/**
 * FR-080 — LOS Eligibility controller.
 *
 * POST /api/v1/leads/:id/eligibility — triggers an LOS eligibility check for
 * a lead and returns the resulting read-only snapshot. Protected by
 * JwtAuthGuard (global) + AbacGuard @Requires('move_stage', scopeResolver).
 */
@Controller('leads')
export class EligibilityController {
  constructor(private readonly eligibilityService: EligibilityService) {}

  /**
   * POST /leads/:id/eligibility
   *
   * Auth: JwtAuthGuard (global) + @Requires('move_stage') with scope resolver
   * that resolves the lead's owner (RM=O, BM=B, KYC=B).
   */
  @Post(':id/eligibility')
  @Requires(Capability.MOVE_STAGE, (req: AbacRequestContext) => ({
    resourceType: 'leads',
    resourceId: (req as unknown as { params?: { id?: string } }).params?.id,
  }))
  async requestEligibility(
    @Param('id', new ZodValidationPipe(RequestEligibilityParamSchema.shape.id)) leadId: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Req() req: AbacRequestContext,
  ): Promise<unknown> {
    // Validate optional Idempotency-Key header
    let idempotencyKey: string | undefined;
    if (rawIdempotencyKey) {
      const parsed = IdempotencyKeyHeaderSchema.safeParse(rawIdempotencyKey);
      if (!parsed.success) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
          fields: [{ field: 'Idempotency-Key', issue: parsed.error.issues[0]?.message ?? 'invalid' }],
        });
      }
      idempotencyKey = parsed.data;
    }

    // Correlation id propagated by CorrelationMiddleware (falls back to system).
    const correlationId = getCorrelationId(req as CorrelatedRequest) ?? 'corr_system';

    const result = await this.eligibilityService.requestEligibility(
      leadId,
      user,
      idempotencyKey,
      correlationId,
    );

    const responseData = {
      eligibilitySnapshotId: result.eligibilitySnapshotId,
      leadId: result.leadId,
      requestRef: result.requestRef,
      status: result.status,
      indicativeAmount: result.indicativeAmount,
      tenureMonths: result.tenureMonths,
      rateRange: result.rateRange,
      conditions: result.conditions,
      validityUntil: result.validityUntil,
      responseBasis: result.responseBasis,
      createdAt: result.createdAt,
    };

    // ResponseEnvelopeInterceptor wraps { data, meta, error } for us; for idempotent
    // replay we inject IDEMPOTENT_REPLAY into the error.detail per LLD §Endpoint.
    // Since the interceptor wraps our return value in `data`, we return the
    // entire envelope manually when we need to set error.detail simultaneously.
    if (result.idempotentReplay) {
      return {
        data: responseData,
        meta: { correlation_id: correlationId },
        error: {
          code: null,
          message: null,
          detail: { reason: 'IDEMPOTENT_REPLAY' },
          fields: null,
          retryable: false,
        },
      };
    }

    // Normal path: return just the data object; ResponseEnvelopeInterceptor wraps it.
    return responseData;
  }
}
