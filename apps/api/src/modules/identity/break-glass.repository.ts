import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { GrantStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { BREAK_GLASS_EXPIRY_BATCH_SIZE } from './break-glass.constants';
import type { BreakGlassScopeType } from './break-glass.dto';

/** A break-glass grant row, as the service needs it (subset of the table). */
export interface BreakGlassGrantRow {
  grant_id: string;
  org_id: string;
  grantee_id: string;
  approver_id: string;
  scope_type: BreakGlassScopeType;
  scope_ref: string | null;
  reason: string;
  status: GrantStatus;
  valid_from: Date;
  valid_until: Date;
  created_at: Date;
  updated_at: Date;
}

/** Parameters for inserting a freshly-requested (pending) grant. */
export interface InsertGrantParams {
  orgId: string;
  granteeId: string;
  approverId: string;
  scopeType: BreakGlassScopeType;
  scopeRef: string | null;
  reason: string;
  validFrom: string;
  validUntil: string;
  /** Requester — sets `created_by`/`updated_by`. */
  actorId: string;
}

/** A user's role code within an org (grantee/approver existence + capability). */
export interface UserRoleRow {
  user_id: string;
  role_code: string;
}

/** Filters for {@link BreakGlassRepository.list}. */
export interface ListGrantsArgs {
  status?: GrantStatus;
  page: number;
  limit: number;
}

/** A break-glass grant summary row for the listing (`maker_id` = `created_by`). */
export interface BreakGlassGrantListRow {
  grant_id: string;
  grantee_id: string;
  maker_id: string;
  approver_id: string;
  scope_type: BreakGlassScopeType;
  scope_ref: string | null;
  status: GrantStatus;
  reason: string;
  valid_from: Date;
  valid_until: Date;
}

/** A page of grant summaries plus the total matching the filter. */
export interface BreakGlassGrantsPage {
  rows: BreakGlassGrantListRow[];
  total: number;
}

/**
 * Owner-writes repository for `break_glass_grants` (writer: M1 identity, per
 * auth-matrix `resource_governance`). Every query is parameterised Kysely,
 * `org_id`-scoped, and `LIMIT`-bounded where it returns a list. Writes accept
 * the ambient `tx` so they enlist in the surrounding {@link UnitOfWork}.
 *
 * A grant is born `pending` (the `grant_status` enum gained `pending` in
 * schema v5.3) and only the approve step flips it to `active`; `EntitlementService`
 * reads `status='active'` live, so a pending grant grants no access until a
 * second authoriser approves it (four-eyes).
 */
@Injectable()
export class BreakGlassRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Insert a new grant in `pending` status; returns the created row. */
  async insert(params: InsertGrantParams, tx?: DbTransaction): Promise<BreakGlassGrantRow> {
    const executor = tx ?? this.db;
    const row = await executor
      .insertInto('break_glass_grants')
      .values({
        org_id: params.orgId,
        grantee_id: params.granteeId,
        approver_id: params.approverId,
        scope_type: params.scopeType,
        scope_ref: params.scopeRef,
        reason: params.reason,
        status: GrantStatus.PENDING,
        valid_from: new Date(params.validFrom),
        valid_until: new Date(params.validUntil),
        created_by: params.actorId,
        updated_by: params.actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toRow(row);
  }

  /**
   * List grants for the org, newest-first, optionally narrowed to one `status`.
   * Paginated and ALWAYS LIMIT-bounded (NFR-17); returns the page rows (summary
   * columns only — `maker_id` is the requester `created_by`) and the total count
   * matching the filter. Parameterised Kysely, `org_id`-scoped.
   */
  async list(orgId: string, args: ListGrantsArgs): Promise<BreakGlassGrantsPage> {
    let rowsQuery = this.db
      .selectFrom('break_glass_grants')
      .select([
        'grant_id',
        'grantee_id',
        'created_by as maker_id',
        'approver_id',
        'scope_type',
        'scope_ref',
        'status',
        'reason',
        'valid_from',
        'valid_until',
      ])
      .where('org_id', '=', orgId);
    if (args.status !== undefined) {
      rowsQuery = rowsQuery.where('status', '=', args.status);
    }
    const rows = await rowsQuery
      .orderBy('created_at', 'desc')
      .limit(args.limit)
      .offset((args.page - 1) * args.limit)
      .execute();

    let countQuery = this.db
      .selectFrom('break_glass_grants')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', orgId);
    if (args.status !== undefined) {
      countQuery = countQuery.where('status', '=', args.status);
    }
    const { count } = await countQuery.executeTakeFirstOrThrow();

    return {
      rows: rows.map((r) => ({
        grant_id: r.grant_id,
        grantee_id: r.grantee_id,
        maker_id: r.maker_id,
        approver_id: r.approver_id,
        scope_type: r.scope_type as BreakGlassScopeType,
        scope_ref: r.scope_ref,
        status: r.status,
        reason: r.reason,
        valid_from: asDate(r.valid_from),
        valid_until: asDate(r.valid_until),
      })),
      total: Number(count),
    };
  }

  /** Fetch a grant by id within the org; `undefined` when absent. */
  async findById(grantId: string, orgId: string, tx?: DbTransaction): Promise<BreakGlassGrantRow | undefined> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('break_glass_grants')
      .selectAll()
      .where('grant_id', '=', grantId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
    return row ? this.toRow(row) : undefined;
  }

  /**
   * Transition `pending → active` for the nominated approver. The four-eyes
   * guard rides in the WHERE clause (`approver_id = :approverId AND grantee_id
   * <> :approverId`) as a backstop to the service pre-check and the DB
   * `ck_break_glass_four_eyes` constraint; `status = 'pending'` makes the update
   * idempotency-safe (a second approve matches no row). Returns the updated row,
   * or `undefined` when no row matched (already resolved / wrong approver).
   */
  async setActive(
    grantId: string,
    orgId: string,
    approverId: string,
    tx?: DbTransaction,
  ): Promise<BreakGlassGrantRow | undefined> {
    const executor = tx ?? this.db;
    const row = await executor
      .updateTable('break_glass_grants')
      .set({ status: GrantStatus.ACTIVE, updated_by: approverId, updated_at: new Date() })
      .where('grant_id', '=', grantId)
      .where('org_id', '=', orgId)
      .where('approver_id', '=', approverId)
      .where('grantee_id', '!=', approverId)
      .where('status', '=', GrantStatus.PENDING)
      .returningAll()
      .executeTakeFirst();
    return row ? this.toRow(row) : undefined;
  }

  /**
   * Early revocation: `pending|active → revoked`. Returns the updated row, or
   * `undefined` when the grant was already terminal (expired/revoked) — the
   * service maps that to a `CONFLICT`.
   */
  async revoke(
    grantId: string,
    orgId: string,
    actorId: string,
    tx?: DbTransaction,
  ): Promise<BreakGlassGrantRow | undefined> {
    const executor = tx ?? this.db;
    const row = await executor
      .updateTable('break_glass_grants')
      .set({ status: GrantStatus.REVOKED, updated_by: actorId, updated_at: new Date() })
      .where('grant_id', '=', grantId)
      .where('org_id', '=', orgId)
      .where('status', 'in', [GrantStatus.PENDING, GrantStatus.ACTIVE])
      .returningAll()
      .executeTakeFirst();
    return row ? this.toRow(row) : undefined;
  }

  /**
   * Expiry sweep: flip up to {@link BREAK_GLASS_EXPIRY_BATCH_SIZE} active grants
   * whose `valid_until` has passed to `expired`. Returns the affected grant ids
   * so the job can audit each one. Idempotent: already-expired rows are not
   * matched by `status = 'active'`.
   */
  async expireDue(actorId: string, now: Date, tx?: DbTransaction): Promise<string[]> {
    const executor = tx ?? this.db;
    // Bound the affected set with a sub-select (Kysely UPDATE has no LIMIT), so
    // the sweep stays LIMIT-bounded per NFR-17 and drains a backlog over cycles.
    const due = await executor
      .selectFrom('break_glass_grants')
      .select('grant_id')
      .where('status', '=', GrantStatus.ACTIVE)
      .where('valid_until', '<=', now)
      .orderBy('valid_until', 'asc')
      .limit(BREAK_GLASS_EXPIRY_BATCH_SIZE)
      .execute();

    const ids = due.map((r) => r.grant_id);
    if (ids.length === 0) {
      return [];
    }

    await executor
      .updateTable('break_glass_grants')
      .set({ status: GrantStatus.EXPIRED, updated_by: actorId, updated_at: new Date() })
      .where('grant_id', 'in', ids)
      .where('status', '=', GrantStatus.ACTIVE)
      .execute();

    return ids;
  }

  /** Look up a user's role code within the org (existence + capability check). */
  async findUserRole(userId: string, orgId: string, tx?: DbTransaction): Promise<UserRoleRow | undefined> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('users as u')
      .innerJoin('roles as r', 'r.role_id', 'u.role_id')
      .where('u.user_id', '=', userId)
      .where('u.org_id', '=', orgId)
      .select(['u.user_id', 'r.code as role_code'])
      .limit(1)
      .executeTakeFirst();
    return row ? { user_id: row.user_id, role_code: row.role_code } : undefined;
  }

  /** True when a lead with this id exists in the org (scopeType='lead' check). */
  async leadExists(leadId: string, orgId: string, tx?: DbTransaction): Promise<boolean> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('leads')
      .select(sql<number>`1`.as('one'))
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** True when a branch with this id exists in the org (scopeType='branch' check). */
  async branchExists(branchId: string, orgId: string, tx?: DbTransaction): Promise<boolean> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('branches')
      .select(sql<number>`1`.as('one'))
      .where('branch_id', '=', branchId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  private toRow(row: {
    grant_id: string;
    org_id: string;
    grantee_id: string;
    approver_id: string;
    scope_type: string;
    scope_ref: string | null;
    reason: string;
    status: GrantStatus;
    valid_from: Date | string;
    valid_until: Date | string;
    created_at: Date | string;
    updated_at: Date | string;
  }): BreakGlassGrantRow {
    return {
      grant_id: row.grant_id,
      org_id: row.org_id,
      grantee_id: row.grantee_id,
      approver_id: row.approver_id,
      scope_type: row.scope_type as BreakGlassScopeType,
      scope_ref: row.scope_ref,
      reason: row.reason,
      status: row.status,
      valid_from: asDate(row.valid_from),
      valid_until: asDate(row.valid_until),
      created_at: asDate(row.created_at),
      updated_at: asDate(row.updated_at),
    };
  }
}

/** Kysely returns TIMESTAMPTZ as Date over `pg`, but normalise defensively. */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
