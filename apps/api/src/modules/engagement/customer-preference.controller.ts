import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { DataScope, ERROR_CODES, RoleCode, SubjectType } from '@lms/shared';
import type { ApiEnvelope } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException } from '../../core/http';
import { SYSTEM_ACTOR_ID } from '../capture/capture.constants';
import {
  CUSTOMER_LINK_PORT,
  type CustomerLinkPort,
} from '../compliance/ports/customer-link.port';
import { PutPreferencesDto } from './dto/put-preferences.dto';
import { PreferenceService } from './preference.service';

/** Zod schema for the :token path param. */
const TokenPathParam = z.object({
  token: z.string({ required_error: 'token is required' }).min(1, 'token is required'),
});

const GetPreferencesQuery = z.object({
  subject_type: z.nativeEnum(SubjectType, {
    errorMap: () => ({ message: "subject_type must be 'user' or 'customer'" }),
  }),
  subject_ref: z
    .string({ required_error: 'subject_ref must be a valid UUID' })
    .uuid('subject_ref must be a valid UUID'),
});

type GetPreferencesQuery = z.infer<typeof GetPreferencesQuery>;

/**
 * FR-103 — Customer self-service notification preference endpoints.
 *
 * PUT  /api/v1/c/{token}/preferences  — upsert own preferences via opaque link.
 * GET  /api/v1/c/{token}/preferences  — read own preferences via opaque link.
 *
 * These routes are `@Public()` — JwtAuthGuard skips. Authorisation is the
 * opaque token + OTP step-up validated by {@link CustomerLinkPort}.
 * An unresolvable/expired/revoked token → NOT_FOUND (404, existence hidden
 * per BRD §8.6), consistent with FR-110's CustomerConsentController pattern.
 *
 * Guard enforces: subject_type must be 'customer'; subject_ref must equal the
 * resolved customerProfileId. When customerProfileId is null (unresolved profile
 * link), access is also denied (FORBIDDEN) — a customer with no resolved profile
 * may not set preferences for an arbitrary subject_ref.
 *
 * Audit actor: the system actor (SYSTEM_ACTOR_ID) is used because the customer
 * path has no JWT user; the customer_link_id and lead_id are captured in
 * audit detail instead.
 *
 * NOTE (LLD Ambiguity 1): These paths were not in auth-matrix.json
 * `public_endpoints` or `api-contract.yaml`. Added to both in this delivery.
 * See AMBIGUITY.md §FR-103-A1.
 *
 * NOTE: `CUSTOMER_LINK_PORT` is the FR-060 seam. The bound
 * `UnavailableCustomerLinkAdapter` resolves no token (→ 404) until FR-060
 * rebinds the port in both compliance.module.ts and engagement.module.ts.
 */
@Controller('c')
@Public()
export class CustomerPreferenceController {
  constructor(
    private readonly preferenceService: PreferenceService,
    @Inject(CUSTOMER_LINK_PORT) private readonly links: CustomerLinkPort,
  ) {}

  /**
   * PUT /api/v1/c/{token}/preferences
   * Customer upserts their own notification preferences via an opaque link token.
   */
  @Put(':token/preferences')
  async upsert(
    @Param(new ZodValidationPipe(TokenPathParam)) params: { token: string },
    @Body(new ZodValidationPipe(PutPreferencesDto)) dto: PutPreferencesDto,
  ): Promise<ApiEnvelope<unknown>> {
    const link = await this.links.resolveForConsent(params.token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Deny when customerProfileId is null (unresolved profile — cannot determine
    // which customer this is) OR when subject_ref mismatches the resolved profile.
    // subject_type must also be 'customer' — no JWT user here to set user prefs.
    if (
      dto.subject_type !== SubjectType.CUSTOMER ||
      link.customerProfileId === null ||
      dto.subject_ref !== link.customerProfileId
    ) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // Build a synthetic actor using the well-known SYSTEM actor for audit actor_id.
    // The customer context (lead_id, customer_link_id) is captured in detail by
    // PreferenceService's audit write via the actor reference.
    const actor = {
      userId: SYSTEM_ACTOR_ID,
      orgId: link.orgId,
      role: RoleCode.CUSTOMER,
      scope: DataScope.C,
      jti: params.token.slice(0, 8), // Non-sensitive prefix for audit correlation.
    };

    const { result, warnings } = await this.preferenceService.upsertBatch(dto, actor);
    return {
      data: result,
      meta: {
        correlation_id: '',
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      error: null,
    };
  }

  /**
   * GET /api/v1/c/{token}/preferences
   * Customer reads their own notification preferences via an opaque link token.
   */
  @Get(':token/preferences')
  async get(
    @Param(new ZodValidationPipe(TokenPathParam)) params: { token: string },
    @Query(new ZodValidationPipe(GetPreferencesQuery)) query: GetPreferencesQuery,
  ): Promise<ApiEnvelope<unknown>> {
    const link = await this.links.resolveForConsent(params.token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Same guard as PUT: deny when profile is null or subject_ref mismatches.
    if (
      query.subject_type !== SubjectType.CUSTOMER ||
      link.customerProfileId === null ||
      query.subject_ref !== link.customerProfileId
    ) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const result = await this.preferenceService.getBySubject(
      query.subject_type,
      query.subject_ref,
      link.orgId,
    );
    return { data: result, meta: { correlation_id: '' }, error: null };
  }
}
