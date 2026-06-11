import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';

import { Capability, type ApiEnvelope, type ApiMeta } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import type { AbacRequestContext } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { AuditExplorerQueryDto } from './dto/audit-explorer-query.dto';
import { AuditUnmaskDto } from './dto/audit-unmask.dto';
import {
  AuditExplorerService,
  type AuditExplorerItem,
  type AuditUnmaskResult,
  type IntegrityBadge,
} from './audit-explorer.service';

/** The explorer `data` body: the page of items plus the integrity badge. */
interface AuditExplorerData {
  items: AuditExplorerItem[];
  integrity_badge: IntegrityBadge;
}

/** Explorer `meta`: standard envelope meta + per-page integrity diagnostics. */
interface AuditExplorerMeta extends ApiMeta {
  integrity_checked_count: number;
  integrity_break_at: string | null;
}

/**
 * FR-123 — audit explorer & evidence-unmask endpoints (`/api/v1/audit`). Both are
 * protected by the global `JwtAuthGuard` + `AbacGuard` via
 * `@Requires('audit_trail', …)`; the DPO/ADMIN-only restriction and ADMIN scope
 * confinement are enforced in the service (the capability alone admits narrower
 * roles). The global interceptor back-fills `meta.correlation_id`; this handler
 * returns a full envelope so it can attach the integrity diagnostics to `meta`.
 *
 * Evidence EXPORT is delegated to FR-122 (`POST /exports` with
 * `report_code: 'audit_export'`); this FR does not manage the export job.
 */
@Controller('audit')
@Requires(Capability.AUDIT_TRAIL, () => ({ resourceType: 'audit_logs' }))
export class AuditExplorerController {
  constructor(private readonly service: AuditExplorerService) {}

  @Get()
  @Requires(Capability.AUDIT_TRAIL, () => ({ resourceType: 'audit_logs' }))
  async search(
    @Query(new ZodValidationPipe(AuditExplorerQueryDto)) query: AuditExplorerQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiEnvelope<AuditExplorerData>> {
    const result = await this.service.search(query, user);
    const meta: AuditExplorerMeta = {
      correlation_id: '',
      pagination: result.pagination,
      integrity_checked_count: result.integrityCheckedCount,
      integrity_break_at: result.integrityBreakAt,
    };
    return {
      data: { items: result.items, integrity_badge: result.integrityBadge },
      meta,
      error: null,
    };
  }

  @Post('unmask')
  @HttpCode(200)
  @Requires(Capability.AUDIT_TRAIL, () => ({ resourceType: 'audit_logs' }))
  async unmask(
    @Body(new ZodValidationPipe(AuditUnmaskDto)) dto: AuditUnmaskDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<AuditUnmaskResult> {
    return this.service.unmask(dto, user, req);
  }
}
