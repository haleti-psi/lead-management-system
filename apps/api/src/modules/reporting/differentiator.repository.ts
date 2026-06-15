import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { GrievanceCategory, IntegrationKind, type ScopePredicate } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import { MAX_PAGE_LIMIT } from '../../core/common';
import { pct } from './report.repository';
import type { ReportFilters, ReportPagination } from './report.repository';
import type {
  FirstContactSlaRow,
  FirstContactSlaSummary,
  KycDocAgeingRow,
  DuplicateLeakageRow,
  HandoffFailureRow,
  SourceRoiRow,
  ContactabilityRow,
  ConsentPrivacyOpsRow,
  ConsentStatusCount,
  DataRightsRequestCount,
  GrievanceCount,
  ProductBranchHeatmapRow,
  RmCapacityLoadRow,
} from './dto/report-response.dto';

/**
 * FR-121 — differentiator report aggregate queries. All reads are parameterised
 * Kysely, org_id-scoped, scope-filtered IN SQL (never post-filter), and
 * LIMIT-bounded (≤ MAX_PAGE_LIMIT). Zero writes.
 *
 * Scope filtering delegates to the same predicate-to-WHERE translator used by
 * FR-120 (applyPredicateToLeads / applyPredicateToLeadsViaSa). This ensures the
 * single-implementation rule and prevents cross-scope leaks.
 */
@Injectable()
export class DifferentiatorRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  // ── first_contact_sla ─────────────────────────────────────────────────────

  async firstContactSla(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ summary: FirstContactSlaSummary; rows: FirstContactSlaRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    // Summary aggregate
    let summaryQb = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        sql<string>`count(distinct l.lead_id)`.as('total_leads'),
        sql<string>`count(distinct case when l.stage not in ('captured','assigned','first_contact_pending','consent_pending') then l.lead_id end)`.as('contacted_count'),
        sql<string>`count(distinct case when l.sla_first_contact_due_at is not null and l.sla_first_contact_due_at < now() and l.stage in ('captured','assigned','first_contact_pending') then l.lead_id end)`.as('sla_breached'),
        sql<string>`count(distinct case when l.stage in ('captured','assigned','first_contact_pending') and (l.sla_first_contact_due_at is null or l.sla_first_contact_due_at >= now()) then l.lead_id end)`.as('pending_first_contact'),
      ]);

    summaryQb = this.applyScopeViaSa(summaryQb, predicate);
    summaryQb = this.applyLeadFiltersViaSa(summaryQb as Parameters<typeof this.applyLeadFiltersViaSa>[0], filters) as typeof summaryQb;

    // Breakdown rows by branch
    let rowsQb = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .innerJoin('branches as b', 'b.branch_id', 'l.branch_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'l.branch_id',
        'b.name as branch_name',
        sql<string>`count(distinct l.lead_id)`.as('total'),
        sql<string>`count(distinct case when l.stage not in ('captured','assigned','first_contact_pending','consent_pending') then l.lead_id end)`.as('contacted'),
        sql<string>`count(distinct case when l.sla_first_contact_due_at < now() and l.stage in ('captured','assigned','first_contact_pending') then l.lead_id end)`.as('breached'),
        sql<string>`count(distinct case when l.stage in ('captured','assigned','first_contact_pending') and (l.sla_first_contact_due_at is null or l.sla_first_contact_due_at >= now()) then l.lead_id end)`.as('pending'),
      ])
      .groupBy(['l.branch_id', 'b.name'])
      .orderBy('breached', 'desc')
      .limit(safeLimit)
      .offset(offset);

    rowsQb = this.applyScopeViaSa(rowsQb, predicate);
    rowsQb = this.applyLeadFiltersViaSa(rowsQb as Parameters<typeof this.applyLeadFiltersViaSa>[0], filters) as typeof rowsQb;

    let countQb = this.db
      .selectFrom('leads as l')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct l.branch_id)`.as('count'));
    countQb = this.applyScopeBase(countQb, predicate);
    countQb = this.applyLeadFilters(countQb as Parameters<typeof this.applyLeadFilters>[0], filters) as typeof countQb;

    const [summaryRaw, rawRows, countResult] = await Promise.all([
      summaryQb.executeTakeFirst(),
      rowsQb.execute() as Promise<Array<{
        branch_id: string;
        branch_name: string;
        total: string;
        contacted: string;
        breached: string;
        pending: string;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    const totalLeads = Number(summaryRaw?.total_leads ?? 0);
    const contactedCount = Number(summaryRaw?.contacted_count ?? 0);
    const slaBreached = Number(summaryRaw?.sla_breached ?? 0);
    const pendingFirstContact = Number(summaryRaw?.pending_first_contact ?? 0);
    const denominator = totalLeads - pendingFirstContact;

    const summary: FirstContactSlaSummary = {
      total_leads_in_scope: totalLeads,
      contacted_in_sla: contactedCount,
      sla_breached: slaBreached,
      pending_first_contact: pendingFirstContact,
      sla_compliance_pct: pct(contactedCount, denominator),
    };

    const rows: FirstContactSlaRow[] = rawRows.map((r) => {
      const total = Number(r.total);
      const pending = Number(r.pending);
      const den = total - pending;
      return {
        branch_id: r.branch_id,
        branch_name: r.branch_name,
        total,
        contacted: Number(r.contacted),
        breached: Number(r.breached),
        compliance_pct: pct(Number(r.contacted), den),
      };
    });

    return { summary, rows, total: Number(countResult?.count ?? 0) };
  }

  // ── kyc_doc_ageing ────────────────────────────────────────────────────────

  async kycDocAgeing(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: KycDocAgeingRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('documents as d')
      .innerJoin('leads as l', 'l.lead_id', 'd.lead_id')
      .where('d.org_id', '=', orgId)
      .where('d.deleted_at', 'is', null)
      .where('l.deleted_at', 'is', null)
      .select([
        'd.doc_type',
        'l.product_code',
        sql<string>`round(avg(extract(epoch from (coalesce(d.updated_at, now()) - d.created_at))/86400)::numeric, 2)`.as('avg_age_days'),
        sql<string>`count(distinct d.document_id)`.as('doc_count'),
        sql<string>`count(distinct case when d.status = 'verified' then d.document_id end)`.as('verified_count'),
        sql<string>`count(distinct case when d.status in ('uploaded','under_review','mismatch') then d.document_id end)`.as('pending_count'),
      ])
      .groupBy(['d.doc_type', 'l.product_code'])
      .orderBy('avg_age_days', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyScopeBase(qb, predicate);
    // doc-ageing windows on d.created_at only (LLD §2) — strip the lead-level
    // date window from the shared helper so earlier-created leads with in-window
    // docs are not excluded; keep its product/branch/owner filters.
    qb = this.applyLeadFilters(qb as Parameters<typeof this.applyLeadFilters>[0], { ...filters, from: undefined, to: undefined }) as typeof qb;
    // date filter applies to d.created_at for doc ageing
    if (filters.from) {
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('d.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('d.created_at', '<=', endOfDay);
    }

    let countQb = this.db
      .selectFrom('documents as d')
      .innerJoin('leads as l', 'l.lead_id', 'd.lead_id')
      .where('d.org_id', '=', orgId)
      .where('d.deleted_at', 'is', null)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct concat(d.doc_type, '|', l.product_code))`.as('count'));

    countQb = this.applyScopeBase(countQb, predicate);
    countQb = this.applyLeadFilters(countQb as Parameters<typeof this.applyLeadFilters>[0], { ...filters, from: undefined, to: undefined }) as typeof countQb;
    if (filters.from) {
      countQb = (countQb as unknown as { where: (col: string, op: string, val: Date) => typeof countQb }).where('d.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDayCount = new Date(filters.to);
      endOfDayCount.setUTCHours(23, 59, 59, 999);
      countQb = (countQb as unknown as { where: (col: string, op: string, val: Date) => typeof countQb }).where('d.created_at', '<=', endOfDayCount);
    }

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<Array<{
        doc_type: string;
        product_code: string;
        avg_age_days: string;
        doc_count: string;
        verified_count: string;
        pending_count: string;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    const rows: KycDocAgeingRow[] = rawRows.map((r) => ({
      doc_type: r.doc_type,
      product_code: r.product_code,
      avg_age_days: r.avg_age_days ?? '0',
      doc_count: Number(r.doc_count),
      verified_count: Number(r.verified_count),
      pending_count: Number(r.pending_count),
    }));

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  /**
   * Returns the DSA/Dealer partner IDs in scope for the given orgId + filters.
   * The actual quality scoring is delegated to PartnerQualityService (FR-092).
   * If that service is not yet available (FR-092 not merged), callers must
   * return stub rows with `insufficient_data: true`.
   */
  async dsaDealerPartnerIds(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
  ): Promise<string[]> {
    let qb = this.db
      .selectFrom('partners as p')
      .where('p.org_id', '=', orgId)
      .where('p.type', 'in', ['DSA', 'Dealer'])
      .select('p.partner_id')
      .limit(MAX_PAGE_LIMIT);

    // PARTNER scope: restrict to own partner
    if (predicate.type === 'partner') {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('p.partner_id', '=', predicate.partnerId);
    }
    if (filters.partner_id) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('p.partner_id', '=', filters.partner_id);
    }

    const rows = await qb.execute() as Array<{ partner_id: string }>;
    return rows.map((r) => r.partner_id);
  }

  /** Returns partner legal_name and type for stub rows when FR-092 is absent. */
  async dsaDealerPartnerDetails(
    orgId: string,
    partnerIds: string[],
  ): Promise<Array<{ partner_id: string; legal_name: string; type: string }>> {
    if (partnerIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('partners as p')
      .where('p.org_id', '=', orgId)
      .where('p.partner_id', 'in', partnerIds)
      .select(['p.partner_id', 'p.legal_name', 'p.type'])
      .execute() as Array<{ partner_id: string; legal_name: string; type: string }>;
    return rows;
  }

  // ── duplicate_leakage ─────────────────────────────────────────────────────

  async duplicateLeakage(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: DuplicateLeakageRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('duplicate_matches as dm')
      .innerJoin('leads as l', 'l.lead_id', 'dm.lead_id')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('dm.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'sa.source',
        'sa.partner_id',
        'dm.confidence',
        'dm.action',
        'dm.status',
        sql<string>`count(distinct dm.duplicate_match_id)`.as('count'),
      ])
      .groupBy(['sa.source', 'sa.partner_id', 'dm.confidence', 'dm.action', 'dm.status'])
      .orderBy('count', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyScopeViaSa(qb, predicate);
    if (filters.from) {
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('dm.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('dm.created_at', '<=', endOfDay);
    }
    if (filters.branch_id) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('l.branch_id', '=', filters.branch_id);
    }
    if (filters.source) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('sa.source', '=', filters.source);
    }
    if (filters.partner_id) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('sa.partner_id', '=', filters.partner_id);
    }

    let countQb = this.db
      .selectFrom('duplicate_matches as dm')
      .innerJoin('leads as l', 'l.lead_id', 'dm.lead_id')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('dm.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct dm.duplicate_match_id)`.as('count'));
    countQb = this.applyScopeViaSa(countQb, predicate);

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<Array<{
        source: string;
        partner_id: string | null;
        confidence: string;
        action: string;
        status: string;
        count: string;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    const rows: DuplicateLeakageRow[] = rawRows.map((r) => ({
      source: r.source,
      partner_id: r.partner_id,
      confidence: r.confidence,
      action: r.action,
      status: r.status,
      count: Number(r.count),
    }));

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── handoff_failure ───────────────────────────────────────────────────────

  async handoffFailure(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: HandoffFailureRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    const losKinds: IntegrationKind[] = [
      IntegrationKind.LOS_HANDOFF,
      IntegrationKind.LOS_ELIGIBILITY,
      IntegrationKind.LOS_STATUS,
    ];

    let qb = this.db
      .selectFrom('integration_logs as il')
      .leftJoin('leads as l', 'l.lead_id', 'il.lead_id')
      .where('il.org_id', '=', orgId)
      .where('il.status', '=', 'failed')
      .where('il.integration', 'in', losKinds)
      .select([
        'il.integration',
        'il.error_code',
        'il.http_status',
        sql<string>`count(distinct il.integration_log_id)`.as('failure_count'),
        sql<string>`round(avg(il.retry_count)::numeric, 2)`.as('avg_retries'),
        sql<string>`max(il.created_at)`.as('last_seen_at'),
      ])
      .groupBy(['il.integration', 'il.error_code', 'il.http_status'])
      .orderBy('failure_count', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyScopeBase(qb, predicate);
    if (filters.from) {
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('il.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('il.created_at', '<=', endOfDay);
    }
    if (filters.branch_id) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('l.branch_id', '=', filters.branch_id);
    }

    let countQb = this.db
      .selectFrom('integration_logs as il')
      .leftJoin('leads as l', 'l.lead_id', 'il.lead_id')
      .where('il.org_id', '=', orgId)
      .where('il.status', '=', 'failed')
      .where('il.integration', 'in', losKinds)
      .select(sql<string>`count(distinct concat(il.integration, '|', coalesce(il.error_code,'null'), '|', coalesce(il.http_status::text,'null')))`.as('count'));
    // Scope the count exactly like the data query (was org-wide → cross-scope
    // count leak + broken pagination).
    countQb = this.applyScopeBase(countQb, predicate);
    if (filters.from) {
      countQb = (countQb as unknown as { where: (col: string, op: string, val: Date) => typeof countQb }).where('il.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDayCount = new Date(filters.to);
      endOfDayCount.setUTCHours(23, 59, 59, 999);
      countQb = (countQb as unknown as { where: (col: string, op: string, val: Date) => typeof countQb }).where('il.created_at', '<=', endOfDayCount);
    }
    if (filters.branch_id) {
      countQb = (countQb as unknown as { where: (col: string, op: string, val: string) => typeof countQb }).where('l.branch_id', '=', filters.branch_id);
    }

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as unknown as Promise<Array<{
        integration: string;
        error_code: string | null;
        http_status: number | null;
        failure_count: string;
        avg_retries: string;
        last_seen_at: unknown;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    const rows: HandoffFailureRow[] = rawRows.map((r) => ({
      integration: r.integration,
      error_code: r.error_code,
      http_status: r.http_status,
      failure_count: Number(r.failure_count),
      avg_retries: r.avg_retries ?? '0',
      last_seen_at: r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : String(r.last_seen_at),
    }));

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── source_roi ────────────────────────────────────────────────────────────

  async sourceRoi(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: SourceRoiRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'sa.source',
        'sa.campaign_code',
        'sa.partner_id',
        sql<string>`count(distinct l.lead_id)`.as('total_leads'),
        sql<string>`count(distinct case when l.stage = 'handed_off' then l.lead_id end)`.as('converted'),
        sql<string>`count(distinct case when l.stage = 'rejected' then l.lead_id end)`.as('rejected'),
      ])
      .groupBy(['sa.source', 'sa.campaign_code', 'sa.partner_id'])
      .orderBy('converted', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyScopeViaSa(qb, predicate);
    qb = this.applyLeadFiltersViaSa(qb as Parameters<typeof this.applyLeadFiltersViaSa>[0], filters) as typeof qb;

    let countQb = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct concat(sa.source, '|', coalesce(sa.campaign_code,'null'), '|', coalesce(sa.partner_id::text,'null')))`.as('count'));
    countQb = this.applyScopeViaSa(countQb, predicate);
    countQb = this.applyLeadFiltersViaSa(countQb as Parameters<typeof this.applyLeadFiltersViaSa>[0], filters) as typeof countQb;

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<Array<{
        source: string;
        campaign_code: string | null;
        partner_id: string | null;
        total_leads: string;
        converted: string;
        rejected: string;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    const rows: SourceRoiRow[] = rawRows.map((r) => {
      const total = Number(r.total_leads);
      const converted = Number(r.converted);
      return {
        source: r.source,
        campaign_code: r.campaign_code,
        partner_id: r.partner_id,
        total_leads: total,
        converted,
        rejected: Number(r.rejected),
        conversion_rate_pct: pct(converted, total),
        cost_data_available: false as const,
      };
    });

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── contactability ────────────────────────────────────────────────────────

  async contactability(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: ContactabilityRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('communication_logs as cl')
      .innerJoin('leads as l', 'l.lead_id', 'cl.lead_id')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('cl.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'sa.source',
        'sa.partner_id',
        'cl.channel',
        'cl.failure_reason',
        sql<string>`count(distinct cl.communication_log_id)`.as('total_attempts'),
        sql<string>`count(distinct case when cl.status = 'delivered' then cl.communication_log_id end)`.as('delivered'),
        sql<string>`count(distinct case when cl.status = 'failed' then cl.communication_log_id end)`.as('failed'),
      ])
      .groupBy(['sa.source', 'sa.partner_id', 'cl.channel', 'cl.failure_reason'])
      .orderBy('failed', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyScopeViaSa(qb, predicate);
    if (filters.from) {
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('cl.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('cl.created_at', '<=', endOfDay);
    }
    if (filters.branch_id) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('l.branch_id', '=', filters.branch_id);
    }
    if (filters.source) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('sa.source', '=', filters.source);
    }

    let countQb = this.db
      .selectFrom('communication_logs as cl')
      .innerJoin('leads as l', 'l.lead_id', 'cl.lead_id')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where('cl.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct cl.communication_log_id)`.as('count'));
    countQb = this.applyScopeViaSa(countQb, predicate);

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<Array<{
        source: string;
        partner_id: string | null;
        channel: string;
        failure_reason: string | null;
        total_attempts: string;
        delivered: string;
        failed: string;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    const rows: ContactabilityRow[] = rawRows.map((r) => {
      const total = Number(r.total_attempts);
      const delivered = Number(r.delivered);
      return {
        source: r.source,
        partner_id: r.partner_id,
        channel: r.channel,
        failure_reason: r.failure_reason,
        total_attempts: total,
        delivered,
        failed: Number(r.failed),
        contactability_rate_pct: pct(delivered, total),
      };
    });

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── consent_privacy_ops ───────────────────────────────────────────────────

  async consentPrivacyOps(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: ConsentPrivacyOpsRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    // LLD §8: DPO/HEAD (all/masked scope) see org-wide consent/DRR/grievance
    // counts; every other role sees only within its data scope (via the related
    // lead). Without this, scoped roles received org-wide DRR/grievance counts.
    const scopedView = predicate.type !== 'all' && predicate.type !== 'masked';

    // Consent status breakdown
    let consentQb = this.db
      .selectFrom('leads as l')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'l.consent_status',
        'l.product_code',
        sql<string>`count(distinct l.lead_id)`.as('count'),
      ])
      .groupBy(['l.consent_status', 'l.product_code'])
      .limit(safeLimit);

    consentQb = this.applyScopeBase(consentQb, predicate);
    consentQb = this.applyLeadFilters(consentQb as Parameters<typeof this.applyLeadFilters>[0], filters) as typeof consentQb;

    // Open data rights requests
    let drrQb = this.db
      .selectFrom('data_rights_requests as drr')
      .where('drr.org_id', '=', orgId)
      .where('drr.status', '=', 'open')
      .select([
        'drr.request_type',
        sql<string>`count(distinct drr.data_rights_request_id)`.as('open_count'),
      ])
      .groupBy('drr.request_type')
      .limit(safeLimit);

    if (scopedView) {
      drrQb = (drrQb as unknown as { innerJoin: (t: string, a: string, b: string) => typeof drrQb })
        .innerJoin('leads as l', 'l.lead_id', 'drr.lead_id');
      drrQb = (drrQb as unknown as { where: (col: string, op: string, val: null) => typeof drrQb })
        .where('l.deleted_at', 'is', null);
      drrQb = this.applyScopeBase(drrQb, predicate);
    }
    if (filters.from) {
      drrQb = (drrQb as unknown as { where: (col: string, op: string, val: Date) => typeof drrQb }).where('drr.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      drrQb = (drrQb as unknown as { where: (col: string, op: string, val: Date) => typeof drrQb }).where('drr.created_at', '<=', endOfDay);
    }

    // Open privacy grievances
    let grievQb = this.db
      .selectFrom('grievances as g')
      .where('g.org_id', '=', orgId)
      .where('g.status', 'in', ['open', 'in_progress'])
      .where('g.category', '=', GrievanceCategory.DATA_PRIVACY)
      .select([
        'g.category',
        sql<string>`count(distinct g.grievance_id)`.as('open_count'),
      ])
      .groupBy('g.category')
      .limit(safeLimit);

    if (scopedView) {
      grievQb = (grievQb as unknown as { innerJoin: (t: string, a: string, b: string) => typeof grievQb })
        .innerJoin('leads as l', 'l.lead_id', 'g.lead_id');
      grievQb = (grievQb as unknown as { where: (col: string, op: string, val: null) => typeof grievQb })
        .where('l.deleted_at', 'is', null);
      grievQb = this.applyScopeBase(grievQb, predicate);
    }
    if (filters.from) {
      grievQb = (grievQb as unknown as { where: (col: string, op: string, val: Date) => typeof grievQb }).where('g.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      grievQb = (grievQb as unknown as { where: (col: string, op: string, val: Date) => typeof grievQb }).where('g.created_at', '<=', endOfDay);
    }

    const [consentRaw, drrRaw, grievRaw] = await Promise.all([
      consentQb.execute() as Promise<Array<{ consent_status: string; product_code: string; count: string }>>,
      drrQb.execute() as Promise<Array<{ request_type: string; open_count: string }>>,
      grievQb.execute() as Promise<Array<{ category: string; open_count: string }>>,
    ]);

    const rows: ConsentPrivacyOpsRow[] = [
      ...consentRaw.map((r): ConsentPrivacyOpsRow => ({
        type: 'consent_status',
        data: {
          consent_status: r.consent_status,
          product_code: r.product_code,
          count: Number(r.count),
        } satisfies ConsentStatusCount,
      })),
      ...drrRaw.map((r): ConsentPrivacyOpsRow => ({
        type: 'data_rights_request',
        data: {
          request_type: r.request_type,
          open_count: Number(r.open_count),
        } satisfies DataRightsRequestCount,
      })),
      ...grievRaw.map((r): ConsentPrivacyOpsRow => ({
        type: 'grievance',
        data: {
          category: r.category,
          open_count: Number(r.open_count),
        } satisfies GrievanceCount,
      })),
    ];

    // pagination offset applied to combined rows
    const start = (pagination.page - 1) * safeLimit;
    const paginatedRows = rows.slice(start, start + safeLimit);

    return { rows: paginatedRows, total: rows.length };
  }

  // ── product_branch_heatmap ────────────────────────────────────────────────

  async productBranchHeatmap(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: ProductBranchHeatmapRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('leads as l')
      .innerJoin('branches as b', 'b.branch_id', 'l.branch_id')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select([
        'l.product_code',
        'l.branch_id',
        'b.name as branch_name',
        sql<string>`count(distinct l.lead_id)`.as('volume'),
        sql<string>`count(distinct case when l.stage = 'handed_off' then l.lead_id end)`.as('converted'),
        sql<string>`count(distinct case when l.stage = 'rejected' then l.lead_id end)`.as('rejected'),
      ])
      .groupBy(['l.product_code', 'l.branch_id', 'b.name'])
      .orderBy('l.product_code')
      .orderBy('volume', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyScopeBase(qb, predicate);
    qb = this.applyLeadFilters(qb as Parameters<typeof this.applyLeadFilters>[0], filters) as typeof qb;

    // TAT sub-query: avg hours from assigned → handed_off per product/branch
    let tatQb = this.db
      .selectFrom('stage_history as sh')
      .innerJoin('leads as l2', 'l2.lead_id', 'sh.lead_id')
      .where('sh.org_id', '=', orgId)
      .where('l2.deleted_at', 'is', null)
      .where('sh.to_stage', '=', 'handed_off')
      .select([
        'l2.product_code',
        'l2.branch_id',
        sql<string>`round(avg(extract(epoch from (sh.occurred_at - l2.created_at))/3600)::numeric, 2)`.as('avg_tat_hrs'),
      ])
      .groupBy(['l2.product_code', 'l2.branch_id'])
      .limit(MAX_PAGE_LIMIT);

    tatQb = this.applyScopeBase(tatQb, predicate);
    if (filters.from) {
      tatQb = (tatQb as unknown as { where: (col: string, op: string, val: Date) => typeof tatQb }).where('l2.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      tatQb = (tatQb as unknown as { where: (col: string, op: string, val: Date) => typeof tatQb }).where('l2.created_at', '<=', endOfDay);
    }

    let countQb = this.db
      .selectFrom('leads as l')
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .select(sql<string>`count(distinct concat(l.product_code, '|', l.branch_id))`.as('count'));
    countQb = this.applyScopeBase(countQb, predicate);
    countQb = this.applyLeadFilters(countQb as Parameters<typeof this.applyLeadFilters>[0], filters) as typeof countQb;

    const [rawRows, tatRaw, countResult] = await Promise.all([
      qb.execute() as Promise<Array<{
        product_code: string;
        branch_id: string;
        branch_name: string;
        volume: string;
        converted: string;
        rejected: string;
      }>>,
      tatQb.execute() as Promise<Array<{
        product_code: string;
        branch_id: string;
        avg_tat_hrs: string | null;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    // Build TAT lookup
    const tatMap = new Map<string, string | null>();
    for (const t of tatRaw) {
      tatMap.set(`${t.product_code}|${t.branch_id}`, t.avg_tat_hrs ?? null);
    }

    const rows: ProductBranchHeatmapRow[] = rawRows.map((r) => {
      const volume = Number(r.volume);
      const converted = Number(r.converted);
      return {
        product_code: r.product_code,
        branch_id: r.branch_id,
        branch_name: r.branch_name,
        volume,
        converted,
        rejected: Number(r.rejected),
        conversion_rate_pct: pct(converted, volume),
        avg_tat_hrs: tatMap.get(`${r.product_code}|${r.branch_id}`) ?? null,
      };
    });

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── rm_capacity_load ──────────────────────────────────────────────────────

  async rmCapacityLoad(
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    pagination: ReportPagination,
  ): Promise<{ rows: RmCapacityLoadRow[]; total: number }> {
    const safeLimit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * safeLimit;

    let qb = this.db
      .selectFrom('users as u')
      .innerJoin('leads as l', 'l.owner_id', 'u.user_id')
      .leftJoin('tasks as t', (join) =>
        join
          .onRef('t.lead_id', '=', 'l.lead_id')
          .on('t.status', 'in', ['open', 'in_progress']),
      )
      .where('u.org_id', '=', orgId)
      .where('u.status', '=', 'active')
      .where('l.deleted_at', 'is', null)
      .where('l.stage', 'not in', ['handed_off', 'rejected', 'dormant'])
      .select([
        'u.user_id',
        'u.full_name',
        'u.branch_id',
        'u.team_id',
        sql<string>`count(distinct l.lead_id)`.as('active_leads'),
        sql<string>`count(distinct case when l.stage in ('assigned','first_contact_pending','contacted') then l.lead_id end)`.as('early_stage_leads'),
        sql<string>`count(distinct t.task_id)`.as('open_tasks'),
        sql<string>`count(distinct case when t.status = 'open' and t.due_at < now() then t.task_id end)`.as('overdue_tasks'),
      ])
      .groupBy(['u.user_id', 'u.full_name', 'u.branch_id', 'u.team_id'])
      .orderBy('active_leads', 'desc')
      .limit(safeLimit)
      .offset(offset);

    qb = this.applyScopeBase(qb, predicate);
    if (filters.from) {
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('l.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      qb = (qb as unknown as { where: (col: string, op: string, val: Date) => typeof qb }).where('l.created_at', '<=', endOfDay);
    }
    if (filters.branch_id) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('u.branch_id', '=', filters.branch_id);
    }
    if (filters.team_id) {
      qb = (qb as unknown as { where: (col: string, op: string, val: string) => typeof qb }).where('u.team_id', '=', filters.team_id);
    }

    let countQb = this.db
      .selectFrom('users as u')
      .innerJoin('leads as l', 'l.owner_id', 'u.user_id')
      .where('u.org_id', '=', orgId)
      .where('u.status', '=', 'active')
      .where('l.deleted_at', 'is', null)
      .where('l.stage', 'not in', ['handed_off', 'rejected', 'dormant'])
      .select(sql<string>`count(distinct u.user_id)`.as('count'));
    countQb = this.applyScopeBase(countQb, predicate);

    const [rawRows, countResult] = await Promise.all([
      qb.execute() as Promise<Array<{
        user_id: string;
        full_name: string;
        branch_id: string;
        team_id: string | null;
        active_leads: string;
        early_stage_leads: string;
        open_tasks: string;
        overdue_tasks: string;
      }>>,
      countQb.executeTakeFirst(),
    ]);

    const rows: RmCapacityLoadRow[] = rawRows.map((r) => ({
      user_id: r.user_id,
      full_name: r.full_name,
      branch_id: r.branch_id,
      team_id: r.team_id,
      active_leads: Number(r.active_leads),
      early_stage_leads: Number(r.early_stage_leads),
      open_tasks: Number(r.open_tasks),
      overdue_tasks: Number(r.overdue_tasks),
    }));

    return { rows, total: Number(countResult?.count ?? 0) };
  }

  // ── Scope helpers (mirrors FR-120 applyPredicateBase) ────────────────────

  /**
   * Apply predicate to a query that has `leads as l` in FROM.
   * Mirrors the logic in ReportRepository.applyPredicateBase.
   */
  private applyScopeBase<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
  ): T {
    switch (predicate.type) {
      case 'own':
        return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where('l.owner_id', '=', predicate.userId);
      case 'team':
        if (predicate.userIds.length === 0) {
          return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
        }
        return (qb as unknown as { where: (col: string, op: string, vals: readonly string[]) => T }).where(
          'l.owner_id', 'in', [...predicate.userIds],
        );
      case 'branch':
        return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where('l.branch_id', '=', predicate.branchId);
      case 'region':
        if (predicate.branchIds.length === 0) {
          return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
        }
        return (qb as unknown as { where: (col: string, op: string, vals: readonly string[]) => T }).where(
          'l.branch_id', 'in', [...predicate.branchIds],
        );
      case 'all':
      case 'masked':
        return qb;
      case 'partner':
        return (qb as unknown as { where: (col: string, op: string, subq: unknown) => T }).where(
          'l.source_attribution_id',
          'in',
          this.db
            .selectFrom('source_attributions')
            .select('source_attribution_id')
            .where('partner_id', '=', predicate.partnerId),
        );
      default:
        return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
    }
  }

  /**
   * Apply predicate to a query that has `source_attributions as sa` in FROM
   * (so PARTNER predicate can use sa.partner_id directly).
   */
  private applyScopeViaSa<T extends { where: (...args: never[]) => T }>(
    qb: T,
    predicate: ScopePredicate,
  ): T {
    switch (predicate.type) {
      case 'own':
        return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where('l.owner_id', '=', predicate.userId);
      case 'team':
        if (predicate.userIds.length === 0) {
          return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
        }
        return (qb as unknown as { where: (col: string, op: string, vals: readonly string[]) => T }).where(
          'l.owner_id', 'in', [...predicate.userIds],
        );
      case 'branch':
        return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where('l.branch_id', '=', predicate.branchId);
      case 'region':
        if (predicate.branchIds.length === 0) {
          return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
        }
        return (qb as unknown as { where: (col: string, op: string, vals: readonly string[]) => T }).where(
          'l.branch_id', 'in', [...predicate.branchIds],
        );
      case 'all':
      case 'masked':
        return qb;
      case 'partner':
        return (qb as unknown as { where: (col: string, op: string, val: string) => T }).where(
          'sa.partner_id', '=', predicate.partnerId,
        );
      default:
        return (qb as unknown as { where: (eb: unknown) => T }).where(sql`false` as unknown as never);
    }
  }

  /**
   * Common date/product/source filters applied to leads-based queries.
   * Branch/team/owner filters are intentionally NOT applied here —
   * they are enforced by resolveScope before the query is built (FORBIDDEN if
   * out of scope), then optionally narrowed further by the caller if the
   * filter is provided and in-scope.
   */
  private applyLeadFilters<T extends { where: (...args: never[]) => T }>(
    qb: T,
    filters: ReportFilters,
  ): T {
    let q = qb;
    if (filters.from) {
      q = (q as unknown as { where: (col: string, op: string, val: Date) => T }).where('l.created_at', '>=', filters.from);
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      q = (q as unknown as { where: (col: string, op: string, val: Date) => T }).where('l.created_at', '<=', endOfDay);
    }
    if (filters.product_code) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where('l.product_code', '=', filters.product_code);
    }
    if (filters.branch_id) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where('l.branch_id', '=', filters.branch_id);
    }
    if (filters.team_id) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where('l.team_id', '=', filters.team_id);
    }
    if (filters.owner_id) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where('l.owner_id', '=', filters.owner_id);
    }
    return q;
  }

  /**
   * Variant of applyLeadFilters for queries that already join source_attributions.
   * Adds source + partner_id filter support directly against sa columns.
   */
  private applyLeadFiltersViaSa<T extends { where: (...args: never[]) => T }>(
    qb: T,
    filters: ReportFilters,
  ): T {
    let q = this.applyLeadFilters(qb, filters);
    if (filters.source) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where('sa.source', '=', filters.source);
    }
    if (filters.partner_id) {
      q = (q as unknown as { where: (col: string, op: string, val: string) => T }).where('sa.partner_id', '=', filters.partner_id);
    }
    return q;
  }
}
