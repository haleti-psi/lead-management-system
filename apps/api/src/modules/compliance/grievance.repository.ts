import { Inject, Injectable } from '@nestjs/common';
import type { SelectQueryBuilder } from 'kysely';
import type { Selectable } from 'kysely';

import type { GrievanceCategory, GrievanceSource, GrievanceStatus, ScopePredicate } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { DB, Grievances } from '../../core/db/types.generated';
import { DomainException } from '../../core/http';
import { GRIEVANCE_LIST_MAX_LIMIT } from './grievance.constants';
import type { ListGrievancesQuery } from './dto/list-grievances.dto';

export type GrievanceRow = Selectable<Grievances>;

/** Short alias for the Kysely grievances query builder type. */
type GrievancesQB = SelectQueryBuilder<DB, 'grievances', object>;

/**
 * Insert shape for a new grievance row (LLD §Data Operations — Insert grievance).
 */
export interface NewGrievance {
  grievance_id: string;
  org_id: string;
  grievance_no: string;
  lead_id: string | null;
  source: GrievanceSource;
  category: GrievanceCategory;
  description: string;
  owner_id: string | null;
  sla_due_at: Date | null;
  status: GrievanceStatus;
  response: null;
  closure_proof_ref: null;
  created_by: string;
  updated_by: string;
}

/**
 * Scoped list input resolved by the service (org + ABAC predicate applied).
 */
export interface GrievanceListInput {
  orgId: string;
  predicate: ScopePredicate | undefined;
  callerId: string;
  query: ListGrievancesQuery;
}

/**
 * FR-114 — Kysely-backed repository for `grievances`.
 * M12 is the SOLE writer of this table (owner-writes §11).
 * All reads are parameterised and LIMIT-bounded (NFR-17).
 */
@Injectable()
export class GrievanceRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Fetch a single grievance by ID scoped to `org_id`. Returns `undefined` when
   * not found (existence hidden — service maps to NOT_FOUND, never exposes org).
   */
  async findById(grievanceId: string, orgId: string): Promise<GrievanceRow | undefined> {
    return this.db
      .selectFrom('grievances')
      .selectAll()
      .where('grievance_id', '=', grievanceId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Same as {@link findById} but throws NOT_FOUND when absent (hidden from caller).
   */
  async findByIdOrThrow(grievanceId: string, orgId: string): Promise<GrievanceRow> {
    const row = await this.findById(grievanceId, orgId);
    if (!row) throw new DomainException('NOT_FOUND');
    return row;
  }

  /**
   * Verify `lead_id` exists in this org. Returns `undefined` when not found.
   * (NOT_FOUND is returned to the caller — existence hidden per LLD T07/T08.)
   */
  async findLeadInOrg(
    leadId: string,
    orgId: string,
  ): Promise<{ lead_id: string; branch_id: string | null } | undefined> {
    return this.db
      .selectFrom('leads')
      .select(['lead_id', 'branch_id'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Verify `owner_id` is an active user in this org.
   * Returns `undefined` when not found or inactive.
   */
  async findActiveUserInOrg(
    userId: string,
    orgId: string,
  ): Promise<{ user_id: string } | undefined> {
    return this.db
      .selectFrom('users')
      .select('user_id')
      .where('user_id', '=', userId)
      .where('org_id', '=', orgId)
      .where('status', '=', 'active')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Paginated, scope-filtered grievance list (LLD §Data Operations — List grievances).
   * Returns `{ rows, total }` for the envelope meta.
   */
  async list(input: GrievanceListInput): Promise<{ rows: GrievanceRow[]; total: number }> {
    const { orgId, predicate, callerId, query } = input;
    const limit = Math.min(query.limit, GRIEVANCE_LIST_MAX_LIMIT);
    const offset = (query.page - 1) * limit;

    // Base: org-scoped
    let q: GrievancesQB = this.db.selectFrom('grievances').where('org_id', '=', orgId);

    // Apply ABAC scope predicate (LLD §Auth Check scopeResolver)
    q = this.applyScopePredicate(q, predicate, callerId, orgId);

    // Apply optional query filters
    if (query.status != null) q = q.where('status', '=', query.status);
    if (query.category != null) q = q.where('category', '=', query.category);
    if (query.owner_id != null) q = q.where('owner_id', '=', query.owner_id);
    if (query.lead_id != null) q = q.where('lead_id', '=', query.lead_id);
    if (query.from != null) q = q.where('created_at', '>=', new Date(query.from));
    if (query.to != null) q = q.where('created_at', '<=', new Date(query.to));

    const sortColumn = query.sort.column as 'created_at' | 'sla_due_at' | 'status';

    const [rows, countRow] = await Promise.all([
      q.selectAll().orderBy(sortColumn, query.sort.dir).limit(limit).offset(offset).execute(),
      q
        .select((eb) => eb.fn.count<string>('grievance_id').as('total'))
        .executeTakeFirst(),
    ]);

    return { rows, total: Number(countRow?.total ?? 0) };
  }

  /**
   * Insert a new grievance row inside `tx`. Returns the inserted row.
   * Caller must be inside a UnitOfWork transaction.
   */
  async insert(row: NewGrievance, tx: DbTransaction): Promise<GrievanceRow> {
    return tx
      .insertInto('grievances')
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Update grievance fields inside `tx`. Returns the updated row.
   */
  async update(
    grievanceId: string,
    orgId: string,
    patch: {
      status?: GrievanceStatus;
      response?: string | null;
      closure_proof_ref?: string | null;
      owner_id?: string | null;
      updated_by: string;
      updated_at: Date;
    },
    tx: DbTransaction,
  ): Promise<GrievanceRow> {
    return tx
      .updateTable('grievances')
      .set(patch)
      .where('grievance_id', '=', grievanceId)
      .where('org_id', '=', orgId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Escalation sweep: find breached open/in_progress grievances (LLD §Escalation Sweep).
   * LIMIT 100 (NFR-17).
   */
  async findBreachedForEscalation(
    orgId: string,
    now: Date,
    tx: DbTransaction,
  ): Promise<GrievanceRow[]> {
    return tx
      .selectFrom('grievances')
      .selectAll()
      .where('org_id', '=', orgId)
      .where('status', 'in', ['open', 'in_progress'])
      .where('sla_due_at', '<', now)
      .limit(100)
      .execute();
  }

  /**
   * Set `sla_due_at` on a grievance row inside `tx`.
   * Used by the {@link GrievanceSlaWriterAdapter} (SLA port wiring).
   */
  async setSlaAt(
    grievanceId: string,
    orgId: string,
    dueAt: Date,
    updatedBy: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .updateTable('grievances')
      .set({ sla_due_at: dueAt, updated_by: updatedBy, updated_at: new Date() })
      .where('grievance_id', '=', grievanceId)
      .where('org_id', '=', orgId)
      .execute();
  }

  /**
   * Apply ABAC scope predicate to the base `grievances` query builder.
   * Predicate types are from ScopePredicate (shared/types/abac.types.ts).
   */
  private applyScopePredicate(
    q: GrievancesQB,
    predicate: ScopePredicate | undefined,
    callerId: string,
    orgId: string,
  ): GrievancesQB {
    if (!predicate) return q;

    switch (predicate.type) {
      case 'own':
        // RM: only grievances where owner_id = caller
        return q.where('owner_id', '=', callerId);

      case 'team':
        // SM: owner_id IN (team member IDs resolved by EntitlementService)
        return predicate.userIds.length > 0
          ? q.where('owner_id', 'in', predicate.userIds as string[])
          : q.where('owner_id', '=', callerId);

      case 'branch':
        // BM/KYC: owner_id IN (users in this branch)
        return q.where(
          'owner_id',
          'in',
          this.db
            .selectFrom('users')
            .select('user_id')
            .where('branch_id', '=', predicate.branchId),
        );

      case 'region':
        // Regional scope: owner_id IN (users in these branches)
        return predicate.branchIds.length > 0
          ? q.where(
              'owner_id',
              'in',
              this.db
                .selectFrom('users')
                .select('user_id')
                .where('branch_id', 'in', predicate.branchIds as string[]),
            )
          : q;

      case 'all':
      case 'masked':
        // HEAD/DPO/ADMIN: no additional filter
        return q;

      case 'partner':
        // PARTNER: only grievances linked to their own leads, scoped to this org.
        // leads.source_attribution_id → source_attributions.source_attribution_id → partner_id
        return q.where(
          'lead_id',
          'in',
          this.db
            .selectFrom('leads')
            .select('lead_id')
            .where('org_id', '=', orgId)
            .where(
              'source_attribution_id',
              'in',
              this.db
                .selectFrom('source_attributions')
                .select('source_attribution_id')
                .where('org_id', '=', orgId)
                .where('partner_id', '=', predicate.partnerId),
            ),
        );

      case 'customer_token':
        // Customer-scoped (not used on staff endpoints — defence in depth)
        return q.where('lead_id', '=', predicate.leadId);

      default:
        return q;
    }
  }
}
