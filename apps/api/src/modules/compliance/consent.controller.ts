import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
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
import { paginated, readHeader, type HttpRequestLike, type PaginatedResult } from '../../core/http';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { CONSENT_RECORDS_RESOURCE_TYPE } from './compliance.constants';
import {
  ConsentService,
  type ClientMeta,
  type ConsentActorContext,
  type ConsentCaptureData,
  type ConsentListItem,
} from './consent.service';
import { CaptureConsentDto } from './dto/capture-consent.dto';
import { ListConsentsQuery } from './dto/list-consents.dto';

/** Pins the ABAC resource for the consent endpoints (explicit — never the default). */
const consentRecordsResource = () => ({ resourceType: CONSENT_RECORDS_RESOURCE_TYPE });

/**
 * FR-110 — staff consent-ledger endpoints (api-contract `listConsents` /
 * `captureConsent`). Both run behind the global `JwtAuthGuard` (401) plus
 * `AbacGuard` via `@Requires('consent_ledger', …)` with an explicit scope
 * resolver; the row-level lead check (RM=O, SM=T, BM/KYC=B, HEAD/DPO/ADMIN=A,
 * PARTNER=P) is enforced in the service against the guard's resolved predicate
 * (LLD §Auth Check). Throttle tiers: mutations 60/min, reads 300/min
 * (environment-contract `RATE_LIMIT_MUTATION`/`RATE_LIMIT_READ` defaults).
 */
@Controller('leads/:id/consents')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  /** GET /api/v1/leads/{id}/consents — paginated append-only history (200). */
  @Get()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Requires(Capability.CONSENT_LEDGER, consentRecordsResource)
  async listConsents(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Query(new ZodValidationPipe(ListConsentsQuery)) query: ListConsentsQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<PaginatedResult<ConsentListItem[]>> {
    const result = await this.consents.listForLead(id, query, actorContext(user, req));
    return paginated(result.data, result.pagination);
  }

  /** POST /api/v1/leads/{id}/consents — append one consent event (201). */
  @Post()
  @HttpCode(201)
  @Requires(Capability.CONSENT_LEDGER, consentRecordsResource)
  async captureConsent(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(CaptureConsentDto)) dto: CaptureConsentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<ConsentCaptureData> {
    return this.consents.capture(id, dto, actorContext(user, req));
  }
}

/** Build the service actor context from the authenticated request. */
function actorContext(user: AuthUser, req: AbacRequestContext): ConsentActorContext {
  return {
    userId: user.userId,
    orgId: user.orgId,
    role: user.role,
    predicate: req[SCOPE_PREDICATE_KEY],
    requestMeta: clientMeta(req),
  };
}

/** Client metadata recorded on audit rows (AbacGuard convention; never logged raw). */
export function clientMeta(req: HttpRequestLike): ClientMeta {
  return {
    ip: readHeader(req, 'x-forwarded-for') ?? undefined,
    userAgent: readHeader(req, 'user-agent') ?? undefined,
  };
}
