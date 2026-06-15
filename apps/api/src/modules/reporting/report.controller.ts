import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability, type PaginationMeta } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException } from '../../core/http';
import { ERROR_CODES } from '@lms/shared';
import { GetReportQueryDto, ReportCodeParam } from './dto/get-report-query.dto';
import type { ReportData } from './dto/report-response.dto';
import { ReportService } from './report.service';

/** Response shape: data = report payload, meta includes pagination. */
interface ReportResponse {
  data: ReportData;
  meta: {
    correlation_id: string;
    pagination: PaginationMeta;
  };
  error: null;
}

const reportsResource = () => ({ resourceType: 'reports' });

/**
 * FR-120 — `GET /api/v1/reports/{code}` handler. Protected by the global
 * `JwtAuthGuard` (401 on missing/expired JWT) + `AbacGuard` via
 * `@Requires('reports', reportsResource)` (403 when the role lacks
 * `reports` capability). The `ScopePredicate` resolved by AbacGuard is
 * injected into `ReportService.getReport` for scope-in-SQL enforcement.
 */
@Controller('reports')
@Requires(Capability.REPORTS, reportsResource)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Get(':code')
  async getReport(
    @Param('code') rawCode: string,
    @Query(new ZodValidationPipe(GetReportQueryDto)) query: GetReportQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<ReportResponse> {
    // Validate the `code` path param — unknown codes → VALIDATION_ERROR (400).
    const codeResult = ReportCodeParam.safeParse(rawCode);
    if (!codeResult.success) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, codeResult.error.issues[0]?.message, {
        fields: [{ field: 'code', issue: codeResult.error.issues[0]?.message ?? 'Invalid report code.' }],
      });
    }

    const predicate = req[SCOPE_PREDICATE_KEY];
    if (!predicate) {
      // AbacGuard always sets this on grant — absence means a misconfigured route.
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const { data, total } = await this.service.getReport(codeResult.data, query, user, predicate);

    return {
      data,
      meta: {
        correlation_id: '',
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
        },
      },
      error: null,
    };
  }
}
