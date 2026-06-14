import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires, type AuthUser } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { ListSharingLogsQuery } from './dto/list-sharing-logs.dto';
import { DataSharingLogsService } from './data-sharing-logs.service';
import type { DataSharingLogRow } from './data-sharing-logs.repository';

/** Explicit ABAC scope resolver for the sharing-logs endpoints. */
const dataSharingLogsResource = () => ({ resourceType: 'data_sharing_logs' });

/**
 * FR-111 — DPO oversight view: `GET /leads/{id}/sharing-logs`.
 *
 * Auth: global `JwtAuthGuard` (401) + `AbacGuard` + `@Requires('consent_ledger',
 * dataSharingLogsResource)`. The ABAC guard gates on the `consent_ledger`
 * capability (required for any access). An additional explicit DPO role assertion
 * in {@link DataSharingLogsService#listForLead} enforces the LLD §Auth requirement
 * that this endpoint is DPO-only — HEAD and ADMIN also hold `consent_ledger` at
 * scope `A` in the auth-matrix but are NOT permitted here; RM/BM/SM/KYC/PARTNER/
 * CUSTOMER all hold `consent_ledger` at narrower scopes (O/T/B/P/C) and are
 * rejected by both the ABAC guard and the role check.
 *
 * NOT a public endpoint (not in auth-matrix `public_endpoints`).
 */
@Controller('leads/:id/sharing-logs')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class DataSharingLogsController {
  constructor(private readonly service: DataSharingLogsService) {}

  /**
   * `GET /api/v1/leads/{id}/sharing-logs` — paginated data-sharing audit log
   * for a lead. DPO-only (LLD §Auth). Returns HTTP 200.
   */
  @Get()
  @Requires(Capability.CONSENT_LEDGER, dataSharingLogsResource)
  async listSharingLogs(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Query(new ZodValidationPipe(ListSharingLogsQuery)) query: ListSharingLogsQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<DataSharingLogRow[]>> {
    const result = await this.service.listForLead(id, user, query.page, query.limit);
    return paginated(result.rows, result.pagination);
  }
}
