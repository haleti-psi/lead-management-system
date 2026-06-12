import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import {
  UserStatus,
  type ConsentStatus,
  type KycStatus,
  type LeadStage,
  type ProductCode,
  type ScopePredicate,
} from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { APPROACHING_WINDOW_MINUTES } from '../../core/sla';
import {
  SCORE_BAND_HOT_MIN,
  SCORE_BAND_WARM_MIN,
} from './workspace.constants';
import {
  LeadScopeService,
  leadListBase,
  type LeadListBaseQuery,
} from './lead-scope.service';
import type { LeadFilter, ListLeadsQuery, SortDir, SortField } from './dto/list-leads.dto';

/** Row shape the list query selects (LLD: selected columns only, never `*`).
 *  Raw `name`/`mobile`/`pan_masked` are fetched solely for the service's
 *  masked projection — they are never serialised. */
export interface LeadListRow {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  product_code: ProductCode;
  is_hot: boolean;
  score: number | null;
  consent_status: ConsentStatus;
  kyc_status: KycStatus;
  name: string;
  mobile: string;
  pan_masked: string | null;
}

/** Minimal lead facts the bulk-action re-scope check reads. */
export interface ScopedLeadRef {
  lead_id: string;
  stage: LeadStage;
}

/** Target/caller user facts (scope membership checks; never PII fields). */
export interface WorkspaceUserRef {
  user_id: string;
  branch_id: string | null;
  team_id: string | null;
  region_id: string | null;
}

/** Allow-listed sort field → concrete `leads` column (LLD §sort allow-list). */
const SORT_COLUMNS = {
  lead_code: 'l.lead_code',
  created_at: 'l.created_at',
  updated_at: 'l.updated_at',
  score: 'l.score',
  stage: 'l.stage',
  priority: 'l.priority',
  sla_first_contact_due_at: 'l.sla_first_contact_due_at',
} as const satisfies Record<SortField, string>;

/** `now() + due-soon window` — FR-104's canonical approaching window. */
const dueSoonUntil = () => sql<Date>`now() + make_interval(mins => ${APPROACHING_WINDOW_MINUTES})`;

/**
 * FR-050 — Kysely list + count queries over `leads` (READ-ONLY: M6 never
 * writes `leads`). Every query is parameterised, org-bound, soft-delete-aware,
 * scope-filtered IN SQL (LeadScopeService) and LIMIT-bounded (≤ 100).
 */
@Injectable()
export class LeadListRepository {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly scope: LeadScopeService,
  ) {}

  /** Scoped, filtered, paginated rows + the scope-identical total (LLD step 4). */
  async list(
    orgId: string,
    predicate: ScopePredicate | undefined,
    params: ListLeadsQuery,
  ): Promise<{ rows: LeadListRow[]; total: number }> {
    const base = this.buildListQuery(orgId, predicate, params.filter, params.q);

    const rowsQuery = this.selectListColumns(base, params.sort.field, params.sort.dir)
      .limit(params.limit)
      .offset((params.page - 1) * params.limit);
    const totalQuery = base.select((eb) => eb.fn.countAll<string>().as('total'));

    const [rows, totalRow] = await Promise.all([
      rowsQuery.execute(),
      totalQuery.executeTakeFirst(),
    ]);
    return { rows, total: Number(totalRow?.total ?? 0) };
  }

  /**
   * Bulk-action re-scope (LLD §Backend Flow bulk step 2): of the requested ids,
   * return those actually inside the caller's scope (org + not deleted +
   * scope predicate, all in SQL). Bounded by the ids themselves (≤ 100 by DTO)
   * plus a defensive LIMIT.
   */
  async findLeadsInScope(
    orgId: string,
    predicate: ScopePredicate | undefined,
    leadIds: readonly string[],
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<ScopedLeadRef[]> {
    if (leadIds.length === 0) {
      return [];
    }
    return this.scope
      .applyScope(leadListBase(executor, orgId), predicate)
      .where('l.lead_id', 'in', [...leadIds])
      .select(['l.lead_id', 'l.stage'])
      .limit(leadIds.length)
      .execute();
  }

  /** Active user lookup (target owner / caller placement). Read-only on `users`. */
  async findActiveUser(
    orgId: string,
    userId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<WorkspaceUserRef | undefined> {
    return executor
      .selectFrom('users')
      .select(['user_id', 'branch_id', 'team_id', 'region_id'])
      .where('org_id', '=', orgId)
      .where('user_id', '=', userId)
      .where('status', '=', UserStatus.ACTIVE)
      .limit(1)
      .executeTakeFirst();
  }

  // ── query assembly (exposed for compile-level component tests) ────────────

  /** Base + scope + allow-listed filters + optional free-text `q`. */
  buildListQuery(
    orgId: string,
    predicate: ScopePredicate | undefined,
    filter: LeadFilter,
    q: string | undefined,
  ): LeadListBaseQuery {
    let qb = this.scope.applyScope(leadListBase(this.db, orgId), predicate);
    qb = applyFilters(qb, filter);
    if (q !== undefined) {
      qb = applyFreeText(qb, q);
    }
    return qb;
  }

  /** Selected columns only (LLD step 5) + allow-listed sort. */
  selectListColumns(qb: LeadListBaseQuery, field: SortField, dir: SortDir) {
    return qb
      .select([
        'l.lead_id',
        'l.lead_code',
        'l.stage',
        'l.product_code',
        'l.is_hot',
        'l.score',
        'l.consent_status',
        'l.kyc_status',
        'li.name',
        'li.mobile',
        'li.pan_masked',
      ])
      .orderBy(SORT_COLUMNS[field], dir);
  }
}

/** Compiled allow-listed filter branches (LLD step 3; each key validated by Zod). */
export function applyFilters(qb: LeadListBaseQuery, filter: LeadFilter): LeadListBaseQuery {
  if (filter.product_code) qb = qb.where('l.product_code', 'in', filter.product_code);
  if (filter.stage) qb = qb.where('l.stage', 'in', filter.stage);
  if (filter.branch_id) qb = qb.where('l.branch_id', '=', filter.branch_id);
  if (filter.team_id) qb = qb.where('l.team_id', '=', filter.team_id);
  if (filter.owner_id) qb = qb.where('l.owner_id', '=', filter.owner_id);
  if (filter.source) qb = qb.where('sa.source', '=', filter.source);
  if (filter.partner) qb = qb.where('p.partner_code', '=', filter.partner);
  if (filter.priority) qb = qb.where('l.priority', '=', filter.priority);
  if (filter.consent_status) qb = qb.where('l.consent_status', '=', filter.consent_status);
  if (filter.kyc_status) qb = qb.where('l.kyc_status', '=', filter.kyc_status);
  if (filter.is_hot !== undefined) qb = qb.where('l.is_hot', '=', filter.is_hot);
  if (filter.score_band) qb = applyScoreBand(qb, filter.score_band);
  if (filter.sla_state) qb = applySlaState(qb, filter.sla_state);
  // Date range applies to lead creation time (AC-3 date-range filter).
  if (filter.date_from) qb = qb.where('l.created_at', '>=', filter.date_from);
  if (filter.date_to) qb = qb.where('l.created_at', '<=', filter.date_to);
  return qb;
}

/** `score_band` → range predicate on `l.score` (LLD: hot ≥75, warm 50–74, cold <50). */
function applyScoreBand(qb: LeadListBaseQuery, band: NonNullable<LeadFilter['score_band']>): LeadListBaseQuery {
  switch (band) {
    case 'hot':
      return qb.where('l.score', '>=', SCORE_BAND_HOT_MIN);
    case 'warm':
      return qb.where('l.score', '>=', SCORE_BAND_WARM_MIN).where('l.score', '<', SCORE_BAND_HOT_MIN);
    case 'cold':
      return qb.where('l.score', '<', SCORE_BAND_WARM_MIN);
    case 'unscored':
      return qb.where('l.score', 'is', null);
  }
}

/**
 * `sla_state` → predicate on the STORED `l.sla_first_contact_due_at` (SLA
 * recompute is FR-104's job; FR-050 only reads). `due_soon` uses FR-104's
 * APPROACHING window; comparisons use DB `now()`.
 */
function applySlaState(qb: LeadListBaseQuery, state: NonNullable<LeadFilter['sla_state']>): LeadListBaseQuery {
  switch (state) {
    case 'breached':
      return qb.where('l.sla_first_contact_due_at', '<', sql<Date>`now()`);
    case 'due_soon':
      return qb
        .where('l.sla_first_contact_due_at', '>=', sql<Date>`now()`)
        .where('l.sla_first_contact_due_at', '<=', dueSoonUntil());
    case 'ok':
      return qb.where('l.sla_first_contact_due_at', '>', dueSoonUntil());
    case 'none':
      return qb.where('l.sla_first_contact_due_at', 'is', null);
  }
}

/**
 * Free-text `q` (LLD step 4 + AC-1): lead_code / name (trigram-indexed) /
 * mobile (exact) / masked PAN / GSTIN (exact, upper-cased) / LOS application
 * id (exact) / partner code. Fully parameterised — never interpolated SQL.
 */
export function applyFreeText(qb: LeadListBaseQuery, q: string): LeadListBaseQuery {
  const like = `%${q}%`;
  return qb.where((eb) =>
    eb.or([
      eb('l.lead_code', 'ilike', like),
      eb('li.name', 'ilike', like),
      eb('li.mobile', '=', q),
      eb('li.pan_masked', 'ilike', like),
      eb('li.gstin', '=', q.toUpperCase()),
      eb('l.los_application_id', '=', q),
      eb('p.partner_code', 'ilike', like),
    ]),
  );
}
