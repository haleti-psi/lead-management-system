import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException } from '../../core/http';
import { TokenParam } from '../compliance/dto/customer-consent.dto';
import { CustomerLinkAdapter } from './customer-link.adapter';
import { CallbackRequestDto } from './dto/callback-request.dto';
import { StatusService, type CallbackData, type CustomerStatusData } from './status.service';

/**
 * FR-062 — customer status view + callback (api-contract `customerStatus`,
 * `customerCallback`). `@Public()`; the opaque token + OTP session + purpose
 * ('status' / 'callback') are validated by the {@link CustomerLinkAdapter}
 * (null → NOT_FOUND, existence hidden — the FR-070/110/060 convention). Global
 * per-IP throttle applies.
 */
@Controller('c')
@Public()
export class StatusController {
  constructor(
    private readonly status: StatusService,
    private readonly links: CustomerLinkAdapter,
  ) {}

  /** GET /api/v1/c/{token}/status — customer-safe lead status (200). */
  @Get(':token/status')
  @HttpCode(200)
  async customerStatus(
    @Param('token', new ZodValidationPipe(TokenParam)) token: string,
  ): Promise<CustomerStatusData> {
    const link = await this.links.resolveForStatus(token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    return this.status.getStatus(link);
  }

  /** POST /api/v1/c/{token}/callback — request a callback slot (201). */
  @Post(':token/callback')
  @HttpCode(201)
  async customerCallback(
    @Param('token', new ZodValidationPipe(TokenParam)) token: string,
    @Body(new ZodValidationPipe(CallbackRequestDto)) dto: CallbackRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<CallbackData> {
    const link = await this.links.resolveForCallback(token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    return this.status.requestCallback(link, dto, idempotencyKey);
  }
}
