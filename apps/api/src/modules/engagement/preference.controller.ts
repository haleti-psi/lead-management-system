import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { Capability, ERROR_CODES, SubjectType } from '@lms/shared';
import type { ApiEnvelope } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { CurrentUser, Requires } from '../../core/auth';
import { DomainException } from '../../core/http';
import { ZodValidationPipe } from '../../core/common';
import { PutPreferencesDto } from './dto/put-preferences.dto';
import { PreferenceService } from './preference.service';

/**
 * Query-param schema for GET /preferences.
 * Both fields are required to avoid unbounded reads.
 */
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
 * FR-103 — Notification Preference Centre (internal staff endpoints).
 *
 * PUT  /api/v1/preferences  — batch upsert (RM scope O, BM scope B, …).
 * GET  /api/v1/preferences  — read current matrix for a subject.
 *
 * Both routes require JwtAuthGuard (global) + AbacGuard `customer_comm`
 * capability per auth-matrix.json.
 *
 * Scope resolver for PUT reads `subject_ref` from the parsed request body and
 * passes it as `ownerId` so EntitlementService's O-scope check fires for RMs
 * who attempt to manage a subject they do not own. For GET the same check is
 * applied from the query param. B/T/A-scoped roles are unaffected (their scope
 * is checked against `branchId`/`teamId`/org which are not derivable here
 * without an async DB lookup — the service layer enforces those boundaries).
 *
 * NOTE: The GET endpoint is not yet in api-contract.yaml (LLD Ambiguity 5).
 * It has been added to the contract in this FR's delivery (see
 * `docs/contracts/api-contract.yaml`). Raises AMBIGUITY in AMBIGUITY.md §FR-103.
 */
@Controller('preferences')
export class PreferenceController {
  constructor(private readonly preferenceService: PreferenceService) {}

  /**
   * PUT /api/v1/preferences — batch upsert notification preferences.
   * Returns HTTP 200 with the persisted rows; non-blocking warnings land in
   * `meta.warnings[]` so the ResponseEnvelopeInterceptor does not double-wrap.
   *
   * Scope resolver derives `ownerId` from the request body's `subject_ref`.
   * RM (O-scope): allowed only when `subject_ref` equals their own `userId`.
   * BM/SM/HEAD/ADMIN: branchId/teamId checks happen at the service layer.
   */
  @Put()
  @Requires(Capability.CUSTOMER_COMM, (req) => {
    const body = (req as unknown as { body?: { subject_ref?: string } }).body;
    return {
      resourceType: 'notification_preferences',
      ownerId: body?.subject_ref ?? undefined,
    };
  })
  async upsert(
    @Body(new ZodValidationPipe(PutPreferencesDto)) dto: PutPreferencesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiEnvelope<unknown>> {
    const { result, warnings } = await this.preferenceService.upsertBatch(dto, user);
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
   * GET /api/v1/preferences — read all preferences for a subject.
   * Used by the preference centre UI before rendering the toggle matrix.
   *
   * Scope resolver derives `ownerId` from the `subject_ref` query param.
   */
  @Get()
  @Requires(Capability.CUSTOMER_COMM, (req) => {
    const query = (req as unknown as { query?: { subject_ref?: string } }).query;
    return {
      resourceType: 'notification_preferences',
      ownerId: query?.subject_ref ?? undefined,
    };
  })
  async get(
    @Query(new ZodValidationPipe(GetPreferencesQuery)) query: GetPreferencesQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiEnvelope<unknown>> {
    if (!user.orgId) {
      throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
    }
    const result = await this.preferenceService.getBySubject(
      query.subject_type,
      query.subject_ref,
      user.orgId,
    );
    return { data: result, meta: { correlation_id: '' }, error: null };
  }
}
