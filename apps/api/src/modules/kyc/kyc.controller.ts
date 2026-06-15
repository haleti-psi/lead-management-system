import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability, ERROR_CODES } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException, getCorrelationId } from '../../core/http';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import type { KycVerificationData } from './dto/kyc-verification.dto';
import { KycTypeParam, bodySchemaFor } from './dto/run-kyc.dto';
import { KYC_RESOURCE_TYPE } from './kyc.constants';
import { KycService, type KycActorContext } from './kyc.service';
import { parseUploadBody } from './upload-body.util';

/** Pins the ABAC resource for the KYC endpoint (explicit — never the default). */
const kycResource = () => ({ resourceType: KYC_RESOURCE_TYPE });

/**
 * FR-071 — KYC verification orchestration (api-contract `runKyc`). Runs behind
 * the global `JwtAuthGuard` (401) + `AbacGuard` via `@Requires('verify_doc')`;
 * the service adds the KYC/BM role gate, the row-level branch-scope check, the
 * `kyc` consent gate, and the `kyc_in_progress` stage gate (LLD §Auth/§Flow). The
 * mutation throttle (60/min) follows the FR-070 convention.
 */
@Controller('leads/:id/kyc')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class KycController {
  constructor(private readonly kyc: KycService) {}

  /** POST /api/v1/leads/{id}/kyc/{type} — run a KYC check (200 success/mismatch). */
  @Post(':type')
  @HttpCode(200)
  @Requires(Capability.VERIFY_DOC, kycResource)
  async runKyc(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Param('type') rawType: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<KycVerificationData> {
    // Path param `type` → kyc_type enum (field-named error for TC-011).
    const typeResult = KycTypeParam.safeParse(rawType);
    if (!typeResult.success) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: 'type', issue: typeResult.error.issues[0]?.message ?? 'Invalid KYC type.' }],
      });
    }
    const kycType = typeResult.data;
    const dto = parseUploadBody(bodySchemaFor(kycType), body);

    const ctx: KycActorContext = {
      userId: user.userId,
      orgId: user.orgId,
      role: user.role,
      predicate: req[SCOPE_PREDICATE_KEY],
      correlationId: getCorrelationId(req),
    };
    return this.kyc.runVerification(id, kycType, dto, ctx);
  }
}
