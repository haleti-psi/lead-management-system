import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
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
import { DomainException, paginated, type PaginatedResult } from '../../core/http';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { requestMeta } from '../capture/capture.controller';
import { ListPartnerLeadsQuerySchema, PartnerLeadCreateDto, type ListPartnerLeadsQuery } from './dto/partner-lead-create.dto';
import {
  PartnerLeadService,
  type PartnerLeadCreateView,
  type PartnerLeadView,
} from './partner-lead.service';

const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-091 — partner lead submission (api-contract `partnerCreateLead`/
 * `partnerListLeads`). Global `JwtAuthGuard` (401) + `AbacGuard` via
 * `@Requires('create_lead'/'view_lead')`. Only a PARTNER actor (P-scope predicate)
 * is admitted — any other role's predicate → FORBIDDEN; the `partner_id` is read
 * from the guard's predicate so a partner can only act under their own id.
 */
@Controller('partners/leads')
export class PartnerLeadController {
  constructor(private readonly leads: PartnerLeadService) {}

  /** POST /api/v1/partners/leads — submit a partner lead (201, or 201 replay). */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Requires(Capability.CREATE_LEAD, leadsResource)
  async partnerCreateLead(
    @Body(new ZodValidationPipe(PartnerLeadCreateDto)) dto: PartnerLeadCreateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PartnerLeadCreateView> {
    const partnerId = partnerIdOf(req);
    return this.leads.submit(
      { userId: user.userId, orgId: user.orgId, partnerId, requestMeta: requestMeta(req) },
      dto,
      idempotencyKey || undefined,
    );
  }

  /** GET /api/v1/partners/leads — the partner's own leads, masked + paginated (200). */
  @Get()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Requires(Capability.VIEW_LEAD, leadsResource)
  async partnerListLeads(
    @Query(new ZodValidationPipe(ListPartnerLeadsQuerySchema)) query: ListPartnerLeadsQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<PartnerLeadView[]>> {
    const partnerId = partnerIdOf(req);
    const result = await this.leads.listOwn({ orgId: user.orgId, partnerId }, query);
    return paginated(result.data, result.pagination);
  }
}

/** Read the partner id from the AbacGuard P-scope predicate; non-PARTNER → 403. */
function partnerIdOf(req: AbacRequestContext): string {
  const predicate = req[SCOPE_PREDICATE_KEY];
  if (!predicate || predicate.type !== 'partner') {
    throw new DomainException(ERROR_CODES.FORBIDDEN);
  }
  return predicate.partnerId;
}
