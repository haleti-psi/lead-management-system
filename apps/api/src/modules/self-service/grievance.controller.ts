import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException } from '../../core/http';
import { TokenParam } from '../compliance/dto/customer-consent.dto';
import { CustomerLinkAdapter } from './customer-link.adapter';
import { CreateGrievanceDto } from './dto/create-grievance.dto';
import { GrievanceService, type CreateGrievanceData } from './grievance.service';

/**
 * FR-061 — customer grievance intake (api-contract `customerGrievance`).
 * `@Public()` (no JWT); the opaque token + OTP session + the `grievance` purpose
 * are validated by {@link CustomerLinkAdapter.resolveForGrievance} (null →
 * NOT_FOUND, existence hidden — the FR-070/110 customer-endpoint convention). The
 * global per-IP throttle tier applies.
 */
@Controller('c')
@Public()
export class GrievanceController {
  constructor(
    private readonly grievances: GrievanceService,
    private readonly links: CustomerLinkAdapter,
  ) {}

  /** POST /api/v1/c/{token}/grievance — register a grievance (201). */
  @Post(':token/grievance')
  @HttpCode(201)
  async customerGrievance(
    @Param('token', new ZodValidationPipe(TokenParam)) token: string,
    @Body(new ZodValidationPipe(CreateGrievanceDto)) dto: CreateGrievanceDto,
  ): Promise<CreateGrievanceData> {
    const link = await this.links.resolveForGrievance(token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    return this.grievances.createFromCustomerLink(link, dto);
  }
}
