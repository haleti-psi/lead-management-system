import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';

import { DataScope, ERROR_CODES, RoleCode } from '@lms/shared';

import { AppConfigService } from '../../core/config';
import { DomainException } from '../../core/http';
import { MaskingService } from '../../core/masking';
import { REDIS } from '../../core/redis';
import { EntitlementCacheService } from '../../core/auth/entitlement-cache.service';
import type { AuthUser } from '../../core/auth';
import type { GetDashboardQueryDto } from './dto/get-dashboard-query.dto';
import type {
  DashboardPayload,
  DashboardScopeInfo,
  DashboardWidgets,
  HotLeadRow,
  WidgetError,
} from './dto/dashboard-payload.dto';
import { DashboardRepository } from './dashboard.repository';
import type { DashboardScopeContext } from './types/dashboard-scope-context';

/**
 * FR-053 — assembles the dashboard widget payload. Pure read model: no writes,
 * no UnitOfWork. Scope resolution, cache lookup, six concurrent Kysely queries
 * (via `Promise.allSettled` for per-widget degradation), PII masking, and Redis
 * short-TTL caching.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly entitlementCache: EntitlementCacheService,
    private readonly masking: MaskingService,
    private readonly config: AppConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async getWidgets(user: AuthUser, query: GetDashboardQueryDto): Promise<DashboardPayload> {
    const ctx = await this.resolveScope(user, query);

    const cacheKey = this.buildCacheKey(ctx, query.as_of);
    const ttl = this.config.get('DASHBOARD_CACHE_TTL_SECONDS');

    // ── Redis cache lookup ────────────────────────────────────────────────────
    let cached: DashboardPayload | null = null;
    try {
      const raw = await this.redis.get(cacheKey);
      if (raw) {
        cached = JSON.parse(raw) as DashboardPayload;
      }
    } catch (err) {
      this.logger.warn({ err, cacheKey }, 'Dashboard Redis GET failed; proceeding with live DB query');
    }

    if (cached) {
      return { ...cached, cache_hit: true };
    }

    // ── Six concurrent widget queries ─────────────────────────────────────────
    const [kpiResult, slaResult, hotResult, tasksResult, sourceResult, handoffResult] =
      await Promise.allSettled([
        this.repo.getKpi(ctx),
        this.repo.getSlaAlerts(ctx),
        this.repo.getHotLeads(ctx),
        this.repo.getMyTasks(ctx),
        this.repo.getSourceSummary(ctx),
        this.repo.getHandoffFailures(ctx),
      ]);

    const widgetErrors: WidgetError[] = [];

    const kpi = this.extractOrNull(kpiResult, 'kpi', widgetErrors, ctx.role);
    const slaAlerts = this.extractOrNull(slaResult, 'sla_alerts', widgetErrors, ctx.role);
    const myTasks = this.extractOrNull(tasksResult, 'my_tasks', widgetErrors, ctx.role);
    const sourceSummary = this.extractOrNull(sourceResult, 'source_summary', widgetErrors, ctx.role);
    const handoffRaw = this.extractOrNull(handoffResult, 'handoff_failures', widgetErrors, ctx.role);

    // Mask hot leads PII (name, mobile) per caller role/scope
    let hotLeads: HotLeadRow[] | null = null;
    if (hotResult.status === 'fulfilled') {
      const strict = user.scope === DataScope.M;
      hotLeads = hotResult.value.map((r: { lead_id: string; lead_code: string; stage: string; score: number | null; name: string; mobile: string; owner_name: string }) => ({
        lead_id: r.lead_id,
        lead_code: r.lead_code,
        stage: r.stage,
        score: r.score,
        owner_name: r.owner_name,
        name_masked: this.masking.mask('full_name', r.name, { strict }) ?? '',
        mobile_masked: this.masking.mask('mobile', r.mobile, { strict }) ?? '',
      }));
    } else {
      this.logWidgetError(hotResult.reason, 'hot_leads');
      widgetErrors.push(this.makeWidgetError('hot_leads'));
    }

    const widgets: DashboardWidgets = {
      kpi,
      sla_alerts: slaAlerts,
      hot_leads: hotLeads,
      my_tasks: myTasks,
      source_summary: sourceSummary,
      handoff_failures: handoffRaw
        ? { count: handoffRaw.length, leads: handoffRaw }
        : handoffRaw === null
          ? null
          : { count: 0, leads: [] },
      widget_errors: widgetErrors,
    };

    const scopeInfo = this.buildScopeInfo(ctx, query);

    const payload: DashboardPayload = {
      role: user.role,
      scope: scopeInfo,
      generated_at: ctx.asOf.toISOString(),
      cache_hit: false,
      widgets,
    };

    // ── Write to Redis (fire-and-forget; failure is non-fatal) ───────────────
    try {
      await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', ttl);
    } catch (err) {
      this.logger.warn({ err, cacheKey }, 'Dashboard Redis SET failed; response served without caching');
    }

    return payload;
  }

  /**
   * Resolves the effective scope context from the authenticated user and optional
   * query overrides. Validates that any scope override is within the caller's
   * entitlement; throws `FORBIDDEN` if not.
   */
  async resolveScope(user: AuthUser, query: GetDashboardQueryDto): Promise<DashboardScopeContext> {
    const entitlement = await this.entitlementCache.loadActorEntitlement(user.userId, user.orgId);
    if (!entitlement) {
      throw new DomainException(ERROR_CODES.AUTH_REQUIRED);
    }

    const asOf = query.as_of ? new Date(query.as_of) : new Date();

    let branchIds: string[] = [];
    let teamMemberIds: string[] = [];

    switch (user.role) {
      case RoleCode.RM:
        break; // own-scope: userId only

      case RoleCode.SM: {
        // SM scope: team member user_ids
        const teamId = query.team_id ?? entitlement.teamId;
        if (!teamId) {
          // SM with no team assigned returns empty widget data gracefully
          teamMemberIds = [];
        } else {
          // If team_id override: SM can only see their own team — direct comparison
          if (query.team_id && query.team_id !== entitlement.teamId) {
            throw new DomainException(ERROR_CODES.FORBIDDEN);
          }
          teamMemberIds = await this.entitlementCache.loadTeamMemberIds(teamId, user.orgId);
        }
        break;
      }

      case RoleCode.BM:
      case RoleCode.KYC: {
        // BM/KYC scope: branch-scoped
        const branchId = query.branch_id ?? entitlement.branchId;
        if (!branchId) {
          branchIds = [];
        } else {
          // If branch_id override: verify within the BM's assigned branch
          if (query.branch_id && query.branch_id !== entitlement.branchId) {
            throw new DomainException(ERROR_CODES.FORBIDDEN);
          }
          branchIds = [branchId];
        }
        break;
      }

      case RoleCode.HEAD:
      case RoleCode.DPO: {
        // HEAD/DPO: org-wide. They may override branch_id or team_id for a sub-view.
        if (query.branch_id) {
          branchIds = [query.branch_id];
        } else if (query.team_id) {
          teamMemberIds = await this.entitlementCache.loadTeamMemberIds(query.team_id, user.orgId);
        }
        break;
      }

      default:
        throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    return {
      role: user.role,
      userId: user.userId,
      orgId: user.orgId,
      branchIds,
      teamMemberIds,
      asOf,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildCacheKey(ctx: DashboardScopeContext, asOf: string | undefined): string {
    const scopeData = JSON.stringify({ branchIds: ctx.branchIds, teamIds: ctx.teamMemberIds });
    const scopeHash = createHash('sha256').update(scopeData).digest('hex').slice(0, 16);
    const asOfDate = asOf ? asOf.slice(0, 10) : ctx.asOf.toISOString().slice(0, 10);
    return `dashboard:${ctx.orgId}:${ctx.userId}:${ctx.role}:${scopeHash}:${asOfDate}`;
  }

  private buildScopeInfo(ctx: DashboardScopeContext, query: GetDashboardQueryDto): DashboardScopeInfo {
    if (ctx.branchIds.length === 1) {
      return { branch_id: ctx.branchIds[0] };
    }
    if (query.team_id) {
      return { team_id: query.team_id };
    }
    return {};
  }

  private extractOrNull<T>(
    result: PromiseSettledResult<T>,
    widgetName: string,
    errors: WidgetError[],
    _role: string,
  ): T | null {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    this.logWidgetError(result.reason, widgetName);
    errors.push(this.makeWidgetError(widgetName));
    return null;
  }

  private makeWidgetError(widget: string): WidgetError {
    return { widget, error_code: 'INTERNAL_ERROR', message: 'Widget temporarily unavailable.' };
  }

  private logWidgetError(reason: unknown, widget: string): void {
    this.logger.error({ err: reason, widget }, `Dashboard widget query failed: ${widget}`);
  }
}
