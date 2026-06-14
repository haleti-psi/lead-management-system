import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires, type AuthUser, type ScopeResolver } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { GetDashboardQuerySchema, type GetDashboardQueryDto } from './dto/get-dashboard-query.dto';
import { DashboardService } from './dashboard.service';
import type { DashboardPayload } from './dto/dashboard-payload.dto';

/**
 * Resolves the ABAC resource for the dashboard endpoint. The dashboard is a
 * list/aggregate view — no single lead resource; `resourceType: 'leads'`
 * triggers the role's `reports` capability path in `EntitlementService`.
 * PARTNER/CUSTOMER/ADMIN are denied in `DashboardService.resolveScope`
 * (default → FORBIDDEN) because their roles have no valid scope branch.
 */
const dashboardScopeResolver: ScopeResolver = () => ({ resourceType: 'leads' });

/**
 * FR-053 — `GET /dashboard` (operationId `getDashboard`, x-frs: FR-053).
 *
 * Protected by global `JwtAuthGuard` (401 on missing/expired JWT) +
 * `AbacGuard` via `@Requires('reports', dashboardScopeResolver)` (403 for
 * PARTNER, CUSTOMER, ADMIN without lead-content; auth-matrix §reports
 * capability). Read throttle: 300/min.
 */
@Controller('dashboard')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * Returns role-scoped dashboard widgets for the authenticated user. The
   * `AbacGuard` runs capability check against `reports` using the scope
   * resolver; scope override validation (branch_id / team_id out of caller's
   * entitlement) is performed inside `DashboardService`.
   */
  @Get()
  @Requires(Capability.REPORTS, dashboardScopeResolver)
  async getDashboard(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GetDashboardQuerySchema)) query: GetDashboardQueryDto,
  ): Promise<DashboardPayload> {
    return this.dashboard.getWidgets(user, query);
  }
}
