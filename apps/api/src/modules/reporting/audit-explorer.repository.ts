import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { GrantStatus, type AuditAction } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import { MAX_PAGE_LIMIT } from '../../core/common';

/**
 * The filter set applied to the audit query. `actionIn` is the ADMIN mandatory
 * action allow-list (set by the service, never by the user); `action` is the
 * optional user-supplied single-action filter. Both are parameterised.
 */
export interface AuditFilters {
  lead_id?: string;
  actor_id?: string;
  action?: AuditAction;
  actionIn?: readonly AuditAction[];
  entity_type?: string;
  from?: Date;
  to?: Date;
}

export interface AuditPagination {
  page: number;
  limit: number;
}

/**
 * A row as returned to the explorer service. `ip_device` is deliberately NOT
 * selected — it is forensic-only and must never reach an API consumer
 * (security.md). `detail` is the raw JSONB cell (masking is applied later, by the
 * service, per role/break-glass).
 */
export interface AuditExplorerRow {
  audit_id: string;
  actor_id: string;
  actor_display: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  before_hash: string | null;
  after_hash: string | null;
  prev_audit_hash: string | null;
  detail: unknown;
  created_at: Date;
}

/** The single row the unmask path needs: its `detail` JSONB and identity. */
export interface AuditDetailRow {
  audit_id: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  detail: unknown;
}

/** An active break-glass grant (subset) — presence authorises DPO unmasked view. */
export interface ActiveGrant {
  grant_id: string;
  scope_type: string;
  scope_ref: string | null;
}

/**
 * FR-123 — read-only repository over `audit_logs` (+ a `users`/`roles` join for
 * the actor display, and `break_glass_grants` for the DPO unmasked-access check).
 * Every query is parameterised Kysely, `org_id`-scoped, and every list is
 * `LIMIT`-bounded (≤ {@link MAX_PAGE_LIMIT}; NFR-17). This FR NEVER writes
 * `audit_logs` — it is append-only and sealed solely by `AuditChainConsumer`.
 */
@Injectable()
export class AuditExplorerRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Paginated audit rows, newest first, with a stable `audit_id` tie-break. */
  async search(
    filters: AuditFilters,
    orgId: string,
    pagination: AuditPagination,
  ): Promise<AuditExplorerRow[]> {
    const limit = Math.min(pagination.limit, MAX_PAGE_LIMIT);
    const offset = (pagination.page - 1) * limit;

    const rows = await this.db
      .selectFrom('audit_logs as a')
      .innerJoin('users as u', 'u.user_id', 'a.actor_id')
      .innerJoin('roles as r', 'r.role_id', 'u.role_id')
      .select([
        'a.audit_id',
        'a.actor_id',
        sql<string>`concat(u.full_name, ' · ', r.code)`.as('actor_display'),
        'a.action',
        'a.entity_type',
        'a.entity_id',
        'a.lead_id',
        'a.before_hash',
        'a.after_hash',
        'a.prev_audit_hash',
        'a.detail',
        // ip_device intentionally excluded — never returned in the API.
        'a.created_at',
      ])
      .where('a.org_id', '=', orgId)
      .$if(filters.actionIn != null, (qb) => qb.where('a.action', 'in', filters.actionIn as AuditAction[]))
      .$if(filters.action != null, (qb) => qb.where('a.action', '=', filters.action!))
      .$if(filters.lead_id != null, (qb) => qb.where('a.lead_id', '=', filters.lead_id!))
      .$if(filters.actor_id != null, (qb) => qb.where('a.actor_id', '=', filters.actor_id!))
      .$if(filters.entity_type != null, (qb) => qb.where('a.entity_type', '=', filters.entity_type!))
      .$if(filters.from != null, (qb) => qb.where('a.created_at', '>=', filters.from!))
      .$if(filters.to != null, (qb) => qb.where('a.created_at', '<=', filters.to!))
      .orderBy('a.created_at', 'desc')
      .orderBy('a.audit_id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map((row) => ({
      audit_id: row.audit_id,
      actor_id: row.actor_id,
      actor_display: row.actor_display,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      lead_id: row.lead_id,
      before_hash: row.before_hash,
      after_hash: row.after_hash,
      prev_audit_hash: row.prev_audit_hash,
      detail: row.detail,
      created_at: asDate(row.created_at),
    }));
  }

  /** Total rows matching the same filters (for pagination meta). */
  async count(filters: AuditFilters, orgId: string): Promise<number> {
    const row = await this.db
      .selectFrom('audit_logs as a')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('a.org_id', '=', orgId)
      .$if(filters.actionIn != null, (qb) => qb.where('a.action', 'in', filters.actionIn as AuditAction[]))
      .$if(filters.action != null, (qb) => qb.where('a.action', '=', filters.action!))
      .$if(filters.lead_id != null, (qb) => qb.where('a.lead_id', '=', filters.lead_id!))
      .$if(filters.actor_id != null, (qb) => qb.where('a.actor_id', '=', filters.actor_id!))
      .$if(filters.entity_type != null, (qb) => qb.where('a.entity_type', '=', filters.entity_type!))
      .$if(filters.from != null, (qb) => qb.where('a.created_at', '>=', filters.from!))
      .$if(filters.to != null, (qb) => qb.where('a.created_at', '<=', filters.to!))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /** The caller's active break-glass grant, if any (DPO unmasked-access gate). */
  async findActiveBreakGlass(userId: string, orgId: string, now: Date): Promise<ActiveGrant | undefined> {
    const row = await this.db
      .selectFrom('break_glass_grants')
      .select(['grant_id', 'scope_type', 'scope_ref'])
      .where('org_id', '=', orgId)
      .where('grantee_id', '=', userId)
      .where('status', '=', GrantStatus.ACTIVE)
      .where('valid_from', '<=', now)
      .where('valid_until', '>', now)
      .limit(1)
      .executeTakeFirst();
    return row ?? undefined;
  }

  /** A single audit row's `detail` (for the unmask reveal); `undefined` if absent. */
  async findDetailById(auditId: string, orgId: string): Promise<AuditDetailRow | undefined> {
    const row = await this.db
      .selectFrom('audit_logs')
      .select(['audit_id', 'action', 'entity_type', 'entity_id', 'lead_id', 'detail'])
      .where('audit_id', '=', auditId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
    return row ?? undefined;
  }
}

/** Kysely returns TIMESTAMPTZ as Date over `pg`; normalise defensively. */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
