import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException, type HttpRequestLike } from '../../core/http';
import { clientMeta } from './consent.controller';
import { ConsentService, type CustomerConsentData } from './consent.service';
import { CustomerConsentDto, TokenParam } from './dto/customer-consent.dto';
import { CUSTOMER_LINK_PORT, type CustomerLinkPort } from './ports/customer-link.port';

/**
 * FR-110 (co-owned with M7/FR-060) — `POST /api/v1/c/{token}/consent`
 * (api-contract `customerConsent`; auth-matrix `public_endpoints`).
 *
 * `@Public()` bypasses the JWT guard; authorisation is the opaque link token +
 * OTP step-up, validated through {@link CustomerLinkPort} (FR-060 owns the
 * `customer_links` machinery — until it lands the bound adapter resolves no
 * token). An unresolvable/expired/revoked token → `NOT_FOUND` (404, existence
 * hidden per BRD §8.6). No `@Throttle` override: the global per-IP default
 * tier (`RATE_LIMIT_AUTH`, 10/min) applies — the LLD's public rate (T24).
 */
@Controller('c')
@Public()
export class CustomerConsentController {
  constructor(
    private readonly consents: ConsentService,
    @Inject(CUSTOMER_LINK_PORT) private readonly links: CustomerLinkPort,
  ) {}

  /** POST /api/v1/c/{token}/consent — customer grants/denies a purpose (201). */
  @Post(':token/consent')
  @HttpCode(201)
  async customerConsent(
    @Param('token', new ZodValidationPipe(TokenParam)) token: string,
    @Body(new ZodValidationPipe(CustomerConsentDto)) dto: CustomerConsentDto,
    @Req() req: HttpRequestLike,
  ): Promise<CustomerConsentData> {
    const link = await this.links.resolveForConsent(token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    return this.consents.captureFromCustomer(link, dto, clientMeta(req));
  }
}
