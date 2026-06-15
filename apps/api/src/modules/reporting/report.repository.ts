import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type { LeadSource, ProductCode, ScopePredicate } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import { MAX_PAGE_LIMIT } from '../../core/common';
import type {
  FunnelConversionRow,
  RejectionSummaryRow,
  RmPerformanceRow,
  SourcePerformanceRow,
} from './dto/report-response.dto';

export interface ReportFilters {
  from?: Date;
  to?: Date;
  branch_id?: string;
  team_id?: string;
  owner_id?: string;
  product_code?: ProductCode;
  source?: LeadSource;
  partner_id?: string;
}

export interface ReportPagination {
  page: number;
  limit: number;
}

/** Raw counts from the funnel query (before % computation). */
interface FunnelRaw {
  product_code: string;
  captured: string; // pg bigint → string
  assigned: string;
  contacted: string;
  qualified: string;
  documents_pending: string;
  kyc_in_progress: string;
  handed_off: string;
  rejected: string;
}

/** Raw counts from the source performance query. */
interface SourceRaw {
  source: string;
  captured: string;
  handed_off: string;
}

/** Raw counts from the rm performance query. */
interface RmRaw {
  owner_id: string;
  owner_name: string;
  captured: string;
  contacted: string;
  qualified: string;
  handed_off: string;
  rejected: string;
}

/** Raw counts from the rejection summary query. */
interface RejectionRaw {
  primary_reason: string;
  sub_reason: string | null;
  rejected_count: string;
}

/**
 * FR-120 — report aggregate queries. All reads are parameterised Kysely,
 * org_id-scoped, scope-filtered in SQL (never post-filter), and LIMIT-bounded
 * (≤ MAX_PAGE_LIMIT). Zero writes. Every query on the primary Db instance;
 * replica routing is infrastructure-layer concern (LLD §Assumptions §2).
 */
@Injectable()
export class ReportRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  // ── funnel_conversion ────────────────────────────────────────────────────

  async funnel(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: FunnelConversionRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    // We build a subquery that computes min stage_order per lead so each lead
    // is counted in every stage it reached or surpassed.  Kysely doesn't
    // expose FILTER(WHERE) portably without raw sql, so we use a lateral
    // join on a stage_history subquery.
    const baseResult = await this.buildFunnelQuery(orgId, predicate, filters, safeLimit, offset);
    const countResult = await this.buildFunnelCount(orgId, predicate, filters);

    const rows: FunnelConversionRow[] = baseResult.map((r) => {
      const captured = Number(r.captured);
      const handedOff = Number(r.handed_off);
      const rejected = Number(r.rejected);
      const kycInProgress = Number(r.kyc_in_progress);
      const activePipeline = Math.max(0, captured - handedOff - rejected);
      return {
        dimension: r.product_code,
        captured,
        assigned: Number(r.assigned),
        contacted: Number(r.contacted),
        qualified: Number(r.qualified),
        documents_pending: Number(r.documents_pending),
        kyc_in_progress: kycInProgress,
        handed_off: handedOff,
        rejected,
        active_pipeline: activePipeline,
        overall_conversion_pct: pct(handedOff, captured),
        kyc_conversion_pct: pct(handedOff, kycInProgress),
      };
    });

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  private buildFunnelQuery(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    limit: number,
    offset: number,
  ) {
    // Use a lateral join on stage_history to compute the minimum stage_order
    // reached per lead, then conditionally aggregate per product.
    let qb = this.db
      .selectFrom('leads as l')
      .innerJoin(
        (eb) =>
          eb
            .selectFrom('stage_history as sh')
            .select(['sh.lead_id', sql<number>`min(${sql.raw(stageOrderSql('sh.to_stage'))})`.as('min_order')])
            .groupBy('sh.lead_id')
            .as('sh_min'),
        (join) => join.onRef('sh_min.lead_id', '=', 'l.lead_id'),
      )
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'l.product_code',
        sql<string>`count(distinct l.lead_id)`.as('captured'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('assigned'))} then l.lead_id end)`.as('assigned'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('contacted'))} then l.lead_id end)`.as('contacted'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('qualified'))} then l.lead_id end)`.as('qualified'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('documents_pending'))} then l.lead_id end)`.as('documents_pending'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('kyc_in_progress'))} then l.lead_id end)`.as('kyc_in_progress'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('handed_off'))} then l.lead_id end)`.as('handed_off'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('rejected'))} then l.lead_id end)`.as('rejected'),
      ])
      .groupBy('l.product_code')
      .orderBy('l.product_code')
      .limit(limit)
      .offset(offset);

    qb = this.applyScopeFunnel(qb, predicate);
    qb = this.applyCommonFilters(qb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof qb;
    return qb.execute() as Promise<FunnelRaw[]>;
  }

  private buildFunnelCount(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
  ): Promise<{ count: string } | undefined> {
    let qb = this.db
      .selectFrom('leads as l')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct l.product_code)`.as('count'));

    qb = this.applyScopeBase(qb, predicate);
    qb = this.applyCommonFilters(qb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof qb;
    return qb.executeTakeFirst();
  }

  // ── source_performance ───────────────────────────────────────────────────

  async sourcePerformance(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: SourcePerformanceRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'sa.source',
        sql<string>`count(distinct l.lead_id)`.as('captured'),
        sql<string>`count(distinct case when l.stage = 'handed_off' then l.lead_id end)`.as('handed_off'),
      ])
      .groupBy('sa.source')
      .orderBy('sa.source')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applySourceScope(qb, predicate);
    qb = this.applyCommonFilters(qb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof qb;

    let countQb = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct sa.source)`.as('count'));

    countQb = this.applySourceScope(countQb, predicate);
    countQb = this.applyCommonFilters(countQb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof countQb;

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<SourceRaw[]>,
      countQb.executeTakeFirst(),
    ]);

    const rows: SourcePerformanceRow[] = rawRows.map((r) => ({
      source: r.source,
      captured: Number(r.captured),
      handed_off: Number(r.handed_off),
      source_conversion_pct: pct(Number(r.handed_off), Number(r.captured)),
    }));

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── rm_performance ───────────────────────────────────────────────────────

  async rmPerformance(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: RmPerformanceRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('leads as l')
      .innerJoin('users as u', 'u.user_id', 'l.owner_id')
      .innerJoin(
        (eb) =>
          eb
            .selectFrom('stage_history as sh')
            .select(['sh.lead_id', sql<number>`min(${sql.raw(stageOrderSql('sh.to_stage'))})`.as('min_order')])
            .groupBy('sh.lead_id')
            .as('sh_min'),
        (join) => join.onRef('sh_min.lead_id', '=', 'l.lead_id'),
      )
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'l.owner_id',
        'u.full_name as owner_name',
        sql<string>`count(distinct l.lead_id)`.as('captured'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('contacted'))} then l.lead_id end)`.as('contacted'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('qualified'))} then l.lead_id end)`.as('qualified'),
        sql<string>`count(distinct case when sh_min.min_order <= ${sql.lit(stageOrder('handed_off'))} then l.lead_id end)`.as('handed_off'),
        sql<string>`count(distinct case when l.stage = 'rejected' then l.lead_id end)`.as('rejected'),
      ])
      .groupBy(['l.owner_id', 'u.full_name'])
      .orderBy('captured', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyRmScope(qb, predicate);
    qb = this.applyCommonFilters(qb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof qb;

    let countQb = this.db
      .selectFrom('leads as l')
      .innerJoin('users as u', 'u.user_id', 'l.owner_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct l.owner_id)`.as('count'));

    countQb = this.applyRmScope(countQb, predicate);
    countQb = this.applyCommonFilters(countQb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof countQb;

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<RmRaw[]>,
      countQb.executeTakeFirst(),
    ]);

    const rows: RmPerformanceRow[] = rawRows.map((r) => ({
      owner_id: r.owner_id,
      owner_name: r.owner_name,
      captured: Number(r.captured),
      contacted: Number(r.contacted),
      qualified: Number(r.qualified),
      handed_off: Number(r.handed_off),
      rejected: Number(r.rejected),
      rejection_rate_pct: pct(Number(r.rejected), Number(r.captured)),
    }));

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── rejection_summary ────────────────────────────────────────────────────

  async rejectionSummary(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: RejectionSummaryRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('leads as l')
      .innerJoin('rejection_reasons as rr', 'rr.rejection_reason_id', 'l.rejection_reason_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .where('l.stage', '=', 'rejected')
      .select([
        'rr.primary_reason',
        'rr.sub_reason',
        sql<string>`count(distinct l.lead_id)`.as('rejected_count'),
      ])
      .groupBy(['rr.primary_reason', 'rr.sub_reason'])
      .orderBy('rejected_count', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyRejectionScope(qb, predicate);
    qb = this.applyCommonFilters(qb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof qb;

    let countQb = this.db
      .selectFrom('leads as l')
      .innerJoin('rejection_reasons as rr', 'rr.rejection_reason_id', 'l.rejection_reason_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .where('l.stage', '=', 'rejected')
      .select(sql<string>`count(distinct concat(rr.primary_reason, '|', coalesce(rr.sub_reason, '')))`.as('count'));

    countQb = this.applyRejectionScope(countQb, predicate);
    countQb = this.applyCommonFilters(countQb as Parameters<typeof this.applyCommonFilters>[0], filters) as typeof countQb;

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<RejectionRaw[]>,
      countQb.executeTakeFirst(),
    ]);

    const rows: RejectionSummaryRow[] = rawRows.map((r) => ({
      primary_reason: r.primary_reason,
      sub_reason: r.sub_reason ?? null,
      rejected_count: Number(r.rejected_count),
    }));

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── Scope helpers ────────────────────────────────────────────────────────

  /**
   * Apply the AbacGuard ScopePredicate to a Kysely query builder that includes
   * `leads as l` and `source_attributions as sa` in its FROM clause. Uses `sa`
   * for the PARTNER predicate (partner_id lives on source_attributions).
   */
  private applySourceScope<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
  ): T {
    return this.applyPredicateBase(qb, predicate, true);
  }

  private applyScopeFunnel<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
  ): T {
    return this.applyPredicateBase(qb, predicate, false);
  }

  private applyScopeBase<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
  ): T {
    return this.applyPredicateBase(qb, predicate, false);
  }

  private applyRmScope<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
  ): T {
    return this.applyPredicateBase(qb, predicate, false);
  }

  private applyRejectionScope<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
  ): T {
    return this.applyPredicateBase(qb, predicate, false);
  }

  /**
   * The single scope-in-SQL implementation. All four report queries delegate
   * here so the predicate → WHERE translation is never duplicated.
   * `hasSaJoin` = the query already joins `source_attributions as sa` and can
   * use `sa.partner_id`; funnel/rm/rejection use `l.source_attribution_id` via
   * a sub-select instead.
   */
  private applyPredicateBase<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
    hasSaJoin: boolean,
  ): T {
    switch (predicate.type) {
      case 'own':
        return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where('l.owner_id', '=', predicate.userId);
      case 'team':
        if (predicate.userIds.length === 0) {
          return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
        }
        return (qb as unknown as { where: (col: string, op: string, vals: readonly string[]) => T }).where(
          'l.owner_id',
          'in',
          [...predicate.userIds],
        );
      case 'branch':
        return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where('l.branch_id', '=', predicate.branchId);
      case 'region':
        if (predicate.branchIds.length === 0) {
          return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
        }
        return (qb as unknown as { where: (col: string, op: string, vals: readonly string[]) => T }).where(
          'l.branch_id',
          'in',
          [...predicate.branchIds],
        );
      case 'all':
      case 'masked':
        // org filter already on query — no row predicate needed
        return qb;
      case 'partner':
        if (hasSaJoin) {
          return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where(
            'sa.partner_id',
            '=',
            predicate.partnerId,
          );
        }
        // funnel/rm/rejection: restrict via leads.source_attribution_id subselect
        return (qb as unknown as { where: (col: string, op: string, subq: unknown) => T }).where(
          'l.source_attribution_id',
          'in',
          this.db
            .selectFrom('source_attributions')
            .select('source_attribution_id')
            .where('partner_id', '=', predicate.partnerId),
        );
      default:
        // deny-by-default: unknown predicate type
        return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
    }
  }

  /**
   * Shared optional filters applied to every report query. Period, product,
   * source, branch/team/owner additional narrowing. These are user-supplied
   * optional query params; scope enforcement happens BEFORE (in resolveScope).
   */
  private applyCommonFilters<T extends { where: (...args: never[]) => T }>(
    qb: T,
    filters: ReportFilters,
  ): T {
    let q = qb;
    if (filters.from) {
      q = (q as unknown as { where: (col: string, op: string, val: Date) => T }).where(
        'l.created_at',
        '>=',
        filters.from,
      );
    }
    if (filters.to) {
      // Include the whole `to` day by bumping to end of day
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      q = (q as unknown as { where: (col: string, op: string, val: Date) => T }).where(
        'l.created_at',
        '<=',
        endOfDay,
      );
    }
    if (filters.branch_id) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where(
        'l.branch_id',
        '=',
        filters.branch_id,
      );
    }
    if (filters.team_id) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where(
        'l.team_id',
        '=',
        filters.team_id,
      );
    }
    if (filters.owner_id) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where(
        'l.owner_id',
        '=',
        filters.owner_id,
      );
    }
    if (filters.product_code) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where(
        'l.product_code',
        '=',
        filters.product_code,
      );
    }
    if (filters.source) {
      // source_performance already joins sa — use sa.source directly.
      // For funnel/rm/rejection the query has no sa join, so restrict via a
      // subselect on source_attributions tied to leads.source_attribution_id.
      q = (q as unknown as {
        where: (col: string, op: string, subq: unknown) => T;
      }).where(
        'l.source_attribution_id',
        'in',
        this.db
          .selectFrom('source_attributions')
          .select('source_attribution_id')
          .where('source', '=', filters.source),
      );
    }
    if (filters.partner_id) {
      q = (q as unknown as {
        where: (col: string, op: string, subq: unknown) => T;
      }).where(
        'l.source_attribution_id',
        'in',
        this.db
          .selectFrom('source_attributions')
          .select('source_attribution_id')
          .where('partner_id', '=', filters.partner_id),
      );
    }
    return q;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Monotonic stage order for the funnel. A lead that reached stage N also
 * counts in all earlier stages (§12.5). Values are arbitrary ordinals;
 * the only constraint is that they increase along the normal pipeline path.
 */
function stageOrder(stage: string): number {
  const ORDER: Record<string, number> = {
    captured: 1,
    consent_pending: 2,
    assigned: 3,
    first_contact_pending: 4,
    contacted: 5,
    qualified: 6,
    documents_pending: 7,
    kyc_in_progress: 8,
    eligibility_requested: 9,
    ready_for_handoff: 10,
    handed_off: 11,
    rejected: 12,
    dormant: 13,
  };
  return ORDER[stage] ?? 99;
}

/**
 * Inline SQL CASE expression that maps a stage column reference to its order
 * number for use inside aggregate expressions.
 */
function stageOrderSql(colRef: string): string {
  return `CASE ${colRef}
    WHEN 'captured' THEN 1
    WHEN 'consent_pending' THEN 2
    WHEN 'assigned' THEN 3
    WHEN 'first_contact_pending' THEN 4
    WHEN 'contacted' THEN 5
    WHEN 'qualified' THEN 6
    WHEN 'documents_pending' THEN 7
    WHEN 'kyc_in_progress' THEN 8
    WHEN 'eligibility_requested' THEN 9
    WHEN 'ready_for_handoff' THEN 10
    WHEN 'handed_off' THEN 11
    WHEN 'rejected' THEN 12
    WHEN 'dormant' THEN 13
    ELSE 99 END`;
}

/**
 * Compute a percentage to one decimal place with the zero-denominator rule
 * from BRD §12.5: when denominator = 0 return `"–"` rather than `"0"` or NaN.
 */
export function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '–';
  return ((numerator / denominator) * 100).toFixed(1);
}
