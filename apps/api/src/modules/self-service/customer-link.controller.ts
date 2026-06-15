import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
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
import { CreateCustomerLinkDto } from './dto/create-customer-link.dto';
import { CUSTOMER_LINK_RESOURCE_TYPE } from './self-service.constants';
import {
  CustomerLinkService,
  type CreateCustomerLinkData,
  type CustomerLinkActorContext,
} from './customer-link.service';

/** Pins the ABAC resource for the staff customer-link endpoint (explicit). */
const customerLinkResource = () => ({ resourceType: CUSTOMER_LINK_RESOURCE_TYPE });

/**
 * FR-060 — staff customer-link creation (api-contract `createCustomerLink`).
 * Global `JwtAuthGuard` (401) + `AbacGuard` via `@Requires('customer_comm')`
 * (RM scope O / BM/KYC scope B); the service enforces the row-level lead scope.
 * 60/min mutation throttle.
 */
@Controller('leads/:id/customer-link')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CustomerLinkController {
  constructor(private readonly links: CustomerLinkService) {}

  /** POST /api/v1/leads/{id}/customer-link — create/resend a customer link (201). */
  @Post()
  @HttpCode(201)
  @Requires(Capability.CUSTOMER_COMM, customerLinkResource)
  async create(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(CreateCustomerLinkDto)) dto: CreateCustomerLinkDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<CreateCustomerLinkData> {
    const ctx: CustomerLinkActorContext = {
      userId: user.userId,
      orgId: user.orgId,
      role: user.role,
      predicate: req[SCOPE_PREDICATE_KEY],
    };
    return this.links.create(id, dto, ctx);
  }
}
