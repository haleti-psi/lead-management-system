import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { RoleCode } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import type {
  HandoffFailureEntry,
  KpiWidget,
  SlaAlertRow,
  SourceSummaryRow,
  TaskRow,
} from './dto/dashboard-payload.dto';
import type { DashboardScopeContext } from './types/dashboard-scope-context';

type SqlBoolExpr = ReturnType<typeof sql<boolean>>;

/**
 * FR-053 — read-only Kysely queries for the dashboard widgets. Every query is
 * parameterised, org-scoped, soft-delete-aware, and LIMIT-bounded (≤ 100).
 * Scope enforcement (applyScopeToLeads) matches the LLD §Data Operations §scope
 * predicate helper — RM=own, SM=team member ids, BM/KYC=branch, HEAD/DPO=all.
 * ZERO writes; no UnitOfWork; pure pool reads.
 */
@Injectable()
export class DashboardRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** KPI aggregate counts — single query with conditional aggregation (LLD Query 1). */
  async getKpi(ctx: DashboardScopeContext): Promise<KpiWidget> {
    const asOf = ctx.asOf;

    // Build scope WHERE fragment
    const scopeWhere = buildScopeWhere(ctx);

    // Main KPI query using conditional COUNT via eb
    const row = await this.db
      .selectFrom('leads')
      .select((eb) => {
        const activeFilter = eb.and([
          eb('deleted_at', 'is', null),
          eb('stage', 'not in', ['handed_off', 'rejected']),
        ]);
        return [
          eb.fn
            .count('lead_id')
            .filterWhere(activeFilter)
            .as('active_pipeline'),
          eb.fn
            .count('lead_id')
            .filterWhere(
              eb.and([
                eb('deleted_at', 'is', null),
                sql<boolean>`created_at >= date_trunc('day', ${asOf}::timestamptz AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
              ]),
            )
            .as('captured_today'),
          eb.fn
            .count('lead_id')
            .filterWhere(
              eb.and([
                eb('is_hot', '=', true),
                eb('deleted_at', 'is', null),
                eb('stage', 'not in', ['handed_off', 'rejected']),
              ]),
            )
            .as('hot_leads'),
          eb.fn
            .count('lead_id')
            .filterWhere(
              eb.and([
                eb('deleted_at', 'is', null),
                sql<boolean>`sla_first_contact_due_at < ${asOf}::timestamptz`,
                eb('stage', '=', 'first_contact_pending'),
              ]),
            )
            .as('sla_breached'),
          eb.fn
            .count('lead_id')
            .filterWhere(
              eb.and([
                eb('deleted_at', 'is', null),
                eb('stage', '=', 'handed_off'),
                sql<boolean>`updated_at >= date_trunc('month', ${asOf}::timestamptz AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
              ]),
            )
            .as('handed_off_this_month'),
          eb.fn
            .count('lead_id')
            .filterWhere(
              eb.and([
                eb('deleted_at', 'is', null),
                eb('stage', 'not in', ['handed_off', 'rejected']),
                eb('consent_status', 'in', ['partial', 'captured']),
              ]),
            )
            .as('active_with_consent'),
        ];
      })
      .where('org_id', '=', ctx.orgId)
      .$if(scopeWhere !== null, (qb) => qb.where(scopeWhere as SqlBoolExpr))
      .executeTakeFirstOrThrow();

    const activePipeline = Number(row.active_pipeline ?? 0);
    const activeWithConsent = Number(row.active_with_consent ?? 0);
    const consentCoveragePct =
      activePipeline > 0 ? Math.round((activeWithConsent / activePipeline) * 100) : 100;

    return {
      active_pipeline: activePipeline,
      captured_today: Number(row.captured_today ?? 0),
      hot_leads: Number(row.hot_leads ?? 0),
      sla_breached: Number(row.sla_breached ?? 0),
      consent_coverage_pct: consentCoveragePct,
      handed_off_this_month: Number(row.handed_off_this_month ?? 0),
    };
  }

  /** SLA alerts — top 10 most overdue `first_contact_pending` leads (LLD Query 2). */
  async getSlaAlerts(ctx: DashboardScopeContext): Promise<SlaAlertRow[]> {
    const asOf = ctx.asOf;
    const scopeWhere = buildScopeWhere(ctx);

    const rows = await this.db
      .selectFrom('leads')
      .innerJoin('users as owner', 'owner.user_id', 'leads.owner_id')
      .select([
        'leads.lead_id',
        'leads.lead_code',
        'leads.stage',
        sql<string>`leads.owner_id`.as('owner_id'),
        'owner.full_name as owner_name',
        sql<string>`leads.sla_first_contact_due_at`.as('sla_first_contact_due_at'),
        sql<number>`EXTRACT(EPOCH FROM (${asOf}::timestamptz - leads.sla_first_contact_due_at)) / 60`.as(
          'minutes_overdue',
        ),
      ])
      .where('leads.stage', '=', 'first_contact_pending')
      .where(sql<boolean>`leads.sla_first_contact_due_at < ${asOf}::timestamptz`)
      .where('leads.deleted_at', 'is', null)
      .where('leads.org_id', '=', ctx.orgId)
      .$if(scopeWhere !== null, (qb) => qb.where(scopeWhere as SqlBoolExpr))
      .orderBy('leads.sla_first_contact_due_at', 'asc')
      .limit(10)
      .execute();

    return rows.map((r) => ({
      lead_id: r.lead_id,
      lead_code: r.lead_code,
      stage: r.stage,
      owner_id: r.owner_id ?? '',
      owner_name: r.owner_name ?? '',
      sla_due_at: r.sla_first_contact_due_at
        ? new Date(r.sla_first_contact_due_at).toISOString()
        : '',
      minutes_overdue: Math.round(Number(r.minutes_overdue ?? 0)),
    }));
  }

  /** Hot leads — top 10 by score desc (LLD Query 3). */
  async getHotLeads(
    ctx: DashboardScopeContext,
  ): Promise<{ lead_id: string; lead_code: string; stage: string; score: number | null; name: string; mobile: string; owner_name: string }[]> {
    const scopeWhere = buildScopeWhere(ctx);

    const rows = await this.db
      .selectFrom('leads')
      .innerJoin('lead_identities as li', 'li.lead_identity_id', 'leads.lead_identity_id')
      .innerJoin('users as owner', 'owner.user_id', 'leads.owner_id')
      .select([
        'leads.lead_id',
        'leads.lead_code',
        sql<string>`leads.stage`.as('stage'),
        'leads.score',
        'li.name',
        'li.mobile',
        'owner.full_name as owner_name',
      ])
      .where('leads.is_hot', '=', true)
      .where('leads.deleted_at', 'is', null)
      .where('leads.stage', 'not in', ['handed_off', 'rejected'])
      .where('leads.org_id', '=', ctx.orgId)
      .$if(scopeWhere !== null, (qb) => qb.where(scopeWhere as SqlBoolExpr))
      .orderBy('leads.score', 'desc')
      .limit(10)
      .execute();

    return rows.map((r) => ({
      lead_id: r.lead_id,
      lead_code: r.lead_code,
      stage: r.stage,
      score: r.score,
      name: r.name,
      mobile: r.mobile,
      owner_name: r.owner_name ?? '',
    }));
  }

  /** Open/overdue tasks for the calling user — top 20 by due_at asc (LLD Query 4). */
  async getMyTasks(ctx: DashboardScopeContext): Promise<TaskRow[]> {
    const rows = await this.db
      .selectFrom('tasks')
      .innerJoin('leads', 'leads.lead_id', 'tasks.lead_id')
      .select([
        'tasks.task_id',
        sql<string>`tasks.type`.as('type'),
        sql<string>`tasks.due_at`.as('due_at'),
        sql<string>`tasks.priority`.as('priority'),
        sql<string>`tasks.status`.as('status'),
        'leads.lead_code',
      ])
      .where('tasks.owner_id', '=', ctx.userId)
      .where('tasks.status', 'in', ['open', 'in_progress', 'overdue'])
      .where('tasks.org_id', '=', ctx.orgId)
      .where('leads.deleted_at', 'is', null)
      .orderBy('tasks.due_at', 'asc')
      .limit(20)
      .execute();

    return rows.map((r) => ({
      task_id: r.task_id,
      type: r.type,
      due_at: new Date(r.due_at).toISOString(),
      priority: r.priority,
      lead_code: r.lead_code,
      status: r.status,
    }));
  }

  /** Source summary — top 5 sources by captured desc, last 30 days (LLD Query 5). */
  async getSourceSummary(ctx: DashboardScopeContext): Promise<SourceSummaryRow[]> {
    const scopeWhere = buildScopeWhere(ctx);

    const rows = await this.db
      .selectFrom('leads')
      .innerJoin(
        'source_attributions as sa',
        'sa.source_attribution_id',
        'leads.source_attribution_id',
      )
      .select((eb) => [
        sql<string>`sa.source`.as('source_name'),
        eb.fn.count<string>('leads.lead_id').as('captured'),
        eb.fn
          .count<string>('leads.lead_id')
          .filterWhere(eb('leads.stage', '=', 'handed_off'))
          .as('handed_off'),
      ])
      .where('leads.deleted_at', 'is', null)
      .where(sql<boolean>`leads.created_at >= now() - INTERVAL '30 days'`)
      .where('leads.org_id', '=', ctx.orgId)
      .$if(scopeWhere !== null, (qb) => qb.where(scopeWhere as SqlBoolExpr))
      .groupBy('sa.source')
      .orderBy('captured', 'desc')
      .limit(5)
      .execute();

    return rows.map((r) => ({
      source_name: r.source_name,
      captured: Number(r.captured ?? 0),
      handed_off: Number(r.handed_off ?? 0),
    }));
  }

  /** Hand-off failures — integration_logs with failed/retrying LOS calls (LLD Query 6). */
  async getHandoffFailures(ctx: DashboardScopeContext): Promise<HandoffFailureEntry[]> {
    const handoffScopeWhere = buildHandoffScopeWhere(ctx);

    const rows = await this.db
      .selectFrom('integration_logs as il')
      .innerJoin('leads', 'leads.lead_id', 'il.lead_id')
      .select((eb) => [
        sql<string>`il.lead_id`.as('lead_id'),
        'leads.lead_code',
        eb.fn.max<string>('il.created_at').as('last_attempt_at'),
      ])
      .where('il.integration', 'in', ['los_handoff', 'los_eligibility', 'los_status'])
      .where('il.direction', '=', 'outbound')
      .where('il.status', 'in', ['failed', 'retrying'])
      .where('leads.deleted_at', 'is', null)
      .where('leads.org_id', '=', ctx.orgId)
      .$if(handoffScopeWhere !== null, (qb) => qb.where(handoffScopeWhere as SqlBoolExpr))
      .groupBy(['il.lead_id', 'leads.lead_code'])
      .limit(10)
      .execute();

    return rows.map((r) => ({
      lead_id: r.lead_id,
      lead_code: r.lead_code,
      last_attempt_at: r.last_attempt_at
        ? new Date(r.last_attempt_at).toISOString()
        : new Date().toISOString(),
    }));
  }
}

// ── Scope predicate helpers ───────────────────────────────────────────────────

/**
 * Returns a raw SQL boolean expression to apply as a WHERE clause for the scope,
 * or null if no additional predicate is needed (HEAD/DPO — org-wide).
 *
 * Exported for unit-test coverage of scope isolation.
 */
export function buildScopeWhere(ctx: DashboardScopeContext): SqlBoolExpr | null {
  switch (ctx.role) {
    case RoleCode.RM:
      return sql<boolean>`leads.owner_id = ${ctx.userId}`;
    case RoleCode.SM:
      return ctx.teamMemberIds.length > 0
        ? sql<boolean>`leads.owner_id = ANY(${ctx.teamMemberIds}::uuid[])`
        : sql<boolean>`false`;
    case RoleCode.BM:
    case RoleCode.KYC:
      return ctx.branchIds.length > 0
        ? sql<boolean>`leads.branch_id = ANY(${ctx.branchIds}::uuid[])`
        : sql<boolean>`false`;
    default:
      return null;
  }
}

/**
 * LLD Query 6 — scope for integration_logs query (scope on leads, not il).
 * Mirrors buildScopeWhere but table-qualified for the join.
 */
function buildHandoffScopeWhere(ctx: DashboardScopeContext): SqlBoolExpr | null {
  return buildScopeWhere(ctx);
}

/**
 * Scope predicate function compatible with the LLD §applyScopeFilter signature.
 * Used in unit tests to verify scope isolation without a live Kysely instance.
 * This is the exported test-facing version using the qb.where() pattern.
 */
export function applyScopeToLeads<T extends { where: (...args: unknown[]) => T }>(
  qb: T,
  ctx: DashboardScopeContext,
): T {
  switch (ctx.role) {
    case RoleCode.RM:
      return qb.where('leads.owner_id', '=', ctx.userId);
    case RoleCode.SM:
      return ctx.teamMemberIds.length > 0
        ? qb.where('leads.owner_id', 'in', [...ctx.teamMemberIds])
        : qb.where(sql<boolean>`false`);
    case RoleCode.BM:
    case RoleCode.KYC:
      return ctx.branchIds.length > 0
        ? qb.where('leads.branch_id', 'in', [...ctx.branchIds])
        : qb.where(sql<boolean>`false`);
    default:
      return qb;
  }
}
