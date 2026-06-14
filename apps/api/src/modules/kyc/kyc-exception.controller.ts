import { Body, Controller, Param, Patch, Req } from '@nestjs/common';
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
import type { ResolveKycExceptionData } from './dto/kyc-verification.dto';
import { ResolveKycExceptionDto } from './dto/resolve-kyc-exception.dto';
import { KYC_RESOURCE_TYPE } from './kyc.constants';
import { KycExceptionService, type KycExceptionActorContext } from './kyc-exception.service';

/** Pins the ABAC resource for the KYC resolve endpoint (explicit — never default). */
const kycResource = () => ({ resourceType: KYC_RESOURCE_TYPE });

/**
 * FR-072 — KYC exception resolution (api-contract `resolveKyc`). Global
 * `JwtAuthGuard` (401) + `AbacGuard` via `@Requires('kyc_signoff')`; the service
 * adds the KYC/BM role gate, branch-scope check, exception-state guard, and the
 * provider_down_manual compliance gate (LLD §Auth/§Flow). 60/min mutation throttle.
 */
@Controller('leads/:id/kyc')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class KycExceptionController {
  constructor(private readonly kycExceptions: KycExceptionService) {}

  /** PATCH /api/v1/leads/{id}/kyc/{kid}/resolve — resolve an open KYC exception (200). */
  @Patch(':kid/resolve')
  @Requires(Capability.KYC_SIGNOFF, kycResource)
  async resolveException(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Param('kid', new ZodValidationPipe(UuidParam)) kid: string,
    @Body(new ZodValidationPipe(ResolveKycExceptionDto)) dto: ResolveKycExceptionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<ResolveKycExceptionData> {
    const ctx: KycExceptionActorContext = {
      userId: user.userId,
      orgId: user.orgId,
      role: user.role,
      predicate: req[SCOPE_PREDICATE_KEY],
    };
    return this.kycExceptions.resolve(id, kid, dto, ctx);
  }
}
