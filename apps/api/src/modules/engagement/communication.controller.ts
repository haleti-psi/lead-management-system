import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { PaginationParams, ZodValidationPipe } from '../../core/common';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import { CommunicationRepository } from './communication.repository';
import { SendCommunicationDto } from './dto/send-communication.dto';
import { NotificationDispatchService } from './notification-dispatch.service';

/** Path param schema: lead UUID. */
const LeadIdParam = z.object({
  id: z.string().uuid('id must be a valid lead UUID'),
});

/**
 * FR-101 — Communication dispatch and history endpoints.
 *
 * POST /api/v1/leads/{id}/communications — consent-gated send (202 Accepted).
 * GET  /api/v1/leads/{id}/communications — paginated comm log list (masked).
 *
 * Both endpoints require JwtAuthGuard (global) + AbacGuard `customer_comm`
 * capability. Scope resolver targets `leads` so EntitlementService checks the
 * caller's data scope against the requested lead.
 */
@Controller('leads')
@Requires(Capability.CUSTOMER_COMM, () => ({ resourceType: 'leads' }))
export class CommunicationController {
  constructor(
    private readonly dispatchService: NotificationDispatchService,
    private readonly commRepo: CommunicationRepository,
  ) {}

  /**
   * GET /api/v1/leads/:id/communications — paginated communication log list.
   *
   * Masking: `recipient` (phone/email) is replaced with `null` in the response
   * — raw PII must not appear in list payloads per security.md §3.
   */
  @Get(':id/communications')
  async list(
    @Param(new ZodValidationPipe(LeadIdParam)) params: { id: string },
    @Query(new ZodValidationPipe(PaginationParams)) pagination: PaginationParams,
    @CurrentUser() user: AuthUser,
  ) {
    const { rows, total } = await this.commRepo.listByLead(
      params.id,
      user.orgId ?? ORG_ID_DEFAULT,
      pagination,
    );

    // Mask recipient (phone/email) — never expose raw PII in list responses.
    const data = rows.map(({ recipient: _recipient, ...rest }) => ({
      ...rest,
      recipient: null as null,
    }));

    return {
      data,
      meta: { page: pagination.page, limit: pagination.limit, total },
    };
  }

  /**
   * POST /api/v1/leads/:id/communications — consent-gated message dispatch.
   */
  @Post(':id/communications')
  @HttpCode(202)
  async send(
    @Param(new ZodValidationPipe(LeadIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(SendCommunicationDto)) dto: SendCommunicationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dispatchService.send(params.id, dto, user);
  }
}
