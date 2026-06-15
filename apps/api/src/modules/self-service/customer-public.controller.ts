import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException } from '../../core/http';
import { ERROR_CODES } from '@lms/shared';
import { CUSTOMER_LINK_KEY, CustomerLinkGuard, type CustomerLinkRequest } from './customer-link.guard';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
import { CustomerLinkService, type CustomerOpenData } from './customer-link.service';

/**
 * FR-060 — public customer micro-site endpoints (api-contract `customerOpen`,
 * `customerOtp`). `@Public()` (no JWT) + `CustomerLinkGuard` (token validity; no
 * OTP gate at these steps — they are the landing and OTP-entry steps). The
 * upload/consent endpoints live in M8/M12 and gate on the OTP session via the
 * `CustomerLinkPort` adapter.
 */
@Controller('c')
@Public()
@UseGuards(CustomerLinkGuard)
export class CustomerPublicController {
  constructor(
    private readonly links: CustomerLinkService,
    private readonly otp: OtpService,
  ) {}

  /** GET /api/v1/c/{token} — open the micro-site landing (200). */
  @Get(':token')
  @HttpCode(200)
  async open(@Req() req: CustomerLinkRequest): Promise<CustomerOpenData> {
    const link = req[CUSTOMER_LINK_KEY];
    if (!link) throw new DomainException(ERROR_CODES.NOT_FOUND);
    return this.links.open(link);
  }

  /** POST /api/v1/c/{token}/otp — verify the OTP step-up (200). */
  @Post(':token/otp')
  @HttpCode(200)
  async verifyOtp(
    @Req() req: CustomerLinkRequest,
    @Body(new ZodValidationPipe(VerifyOtpDto)) dto: VerifyOtpDto,
  ): Promise<{ otp_verified: boolean; session_expires_at: Date }> {
    const link = req[CUSTOMER_LINK_KEY];
    if (!link) throw new DomainException(ERROR_CODES.NOT_FOUND);
    const { sessionExpiresAt } = await this.otp.verify(link.customer_link_id, dto.otp);
    await this.links.markVerified(link.customer_link_id);
    return { otp_verified: true, session_expires_at: sessionExpiresAt };
  }
}
