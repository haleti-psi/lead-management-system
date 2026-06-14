import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';

import { ERROR_CODES, RightsType } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException, type HttpRequestLike } from '../../core/http';
import { DataRightsService, type DataRightsActorContext, type DataRightsData } from './data-rights.service';
import { TokenParam } from './dto/customer-consent.dto';
import { CUSTOMER_LINK_PORT, type CustomerLinkPort } from './ports/customer-link.port';

/**
 * Customer self-service body for `POST /c/{token}/data-rights`.
 * `customerProfileId` and `leadId` are resolved from the validated token,
 * not supplied by the client.
 */
const CustomerRaiseDataRightsDto = z.object({
  request_type: z.nativeEnum(RightsType, {
    errorMap: () => ({
      message:
        'request_type must be one of: access, correction, update, erasure, withdrawal, grievance.',
    }),
  }),
});
type CustomerRaiseDataRightsDto = z.infer<typeof CustomerRaiseDataRightsDto>;

/**
 * FR-112 — `POST /api/v1/c/{token}/data-rights` (api-contract
 * `customerRaiseDataRights`; auth-matrix `public_endpoints`).
 *
 * `@Public()` bypasses the JWT guard; authorisation is the opaque link token,
 * validated through {@link CustomerLinkPort} (FR-060 owns the `customer_links`
 * machinery — until it lands the bound adapter resolves no token → 404).
 *
 * The caller is the data subject. `customerProfileId` and `leadId` are
 * resolved from the token, NOT supplied by the client. The resulting actor
 * context is scoped to that lead only (scope C).
 *
 * Rate limit: global per-IP default (environment-contract `RATE_LIMIT_AUTH`,
 * 10/min). No `@Throttle` override needed; no JWT in scope.
 */
@Controller('c')
@Public()
export class CustomerDataRightsController {
  constructor(
    private readonly dataRights: DataRightsService,
    @Inject(CUSTOMER_LINK_PORT) private readonly links: CustomerLinkPort,
  ) {}

  /** POST /api/v1/c/{token}/data-rights — customer raises a data-rights request. 201. */
  @Post(':token/data-rights')
  @HttpCode(201)
  async customerRaiseDataRights(
    @Param('token', new ZodValidationPipe(TokenParam)) token: string,
    @Body(new ZodValidationPipe(CustomerRaiseDataRightsDto)) dto: CustomerRaiseDataRightsDto,
    @Req() _req: HttpRequestLike,
  ): Promise<DataRightsData> {
    const link = await this.links.resolveForConsent(token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // The customer is both actor and data subject; scope is C (their own lead).
    const ctx: DataRightsActorContext = {
      callerId: link.leadId,   // the lead itself is the actor proxy until FR-060 provides a customer user ID
      orgId: link.orgId,
      predicate: undefined,    // customer-link scope: no predicate; service does not apply scope filtering
    };

    return this.dataRights.create(
      {
        customerProfileId: link.customerProfileId ?? link.leadId,
        leadId: link.leadId,
        requestType: dto.request_type,
      },
      ctx,
    );
  }
}
