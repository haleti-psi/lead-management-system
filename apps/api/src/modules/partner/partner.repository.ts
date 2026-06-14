import { Inject, Injectable } from '@nestjs/common';
import type { Selectable, UpdateObject } from 'kysely';

import type { PartnerStatus, PartnerType, RiskBand } from '@lms/shared';

import { KYSELY, type DB, type DbTransaction, type KyselyDb } from '../../core/db';
import type { Partners } from '../../core/db/types.generated';
import type { PartnerSortField } from './partner.constants';

export type PartnerRow = Selectable<Partners>;

export interface PartnerFilter {
  status?: PartnerStatus;
  type?: PartnerType;
}

/** BM scope: in-branch partners + org-wide (branch_id IS NULL). undefined = all. */
export interface PartnerScope {
  branchId?: string;
}

export interface NewPartner {
  partner_id: string;
  org_id: string;
  partner_code: string;
  type: PartnerType;
  legal_name: string;
  branch_id: string | null;
  products: string[];
  contact_person: string | null;
  contact_mobile: string | null;
  agreement_ref: string | null;
  commission_flag: boolean;
  mapped_rm_id: string | null;
  risk_category: RiskBand | null;
  valid_until: string | null;
  actor_id: string;
}

/** Column-named partial update (service maps camelCase → snake_case). */
export interface PartnerChanges {
  legal_name?: string;
  branch_id?: string | null;
  products?: string;
  contact_person?: string;
  contact_mobile?: string;
  agreement_ref?: string;
  commission_flag?: boolean;
  mapped_rm_id?: string | null;
  risk_category?: RiskBand;
  valid_until?: string;
  status?: PartnerStatus;
}

/**
 * FR-090 — owner repository for `partners` (M10). Parameterised Kysely; every
 * list read is LIMIT-bounded. BM scope filters in-branch + org-wide rows.
 */
@Injectable()
export class PartnerRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async list(
    orgId: string,
    filter: PartnerFilter,
    scope: PartnerScope,
    sort: { field: PartnerSortField; dir: 'asc' | 'desc' },
    page: number,
    limit: number,
  ): Promise<PartnerRow[]> {
    let q = this.db
      .selectFrom('partners')
      .selectAll()
      .where('org_id', '=', orgId);
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.type) q = q.where('type', '=', filter.type);
    if (scope.branchId !== undefined) {
      const branchId = scope.branchId;
      q = q.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    }
    return q
      .orderBy(sort.field, sort.dir)
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();
  }

  async count(orgId: string, filter: PartnerFilter, scope: PartnerScope): Promise<number> {
    let q = this.db.selectFrom('partners').where('org_id', '=', orgId);
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.type) q = q.where('type', '=', filter.type);
    if (scope.branchId !== undefined) {
      const branchId = scope.branchId;
      q = q.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    }
    const row = await q.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async findById(partnerId: string, orgId: string): Promise<PartnerRow | undefined> {
    return this.db
      .selectFrom('partners')
      .selectAll()
      .where('partner_id', '=', partnerId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /** Insert a partner (status starts 'active'). A uq_partners_code 23505 surfaces
   * to the caller, which maps it to CONFLICT. */
  async create(input: NewPartner, tx: DbTransaction): Promise<PartnerRow> {
    return tx
      .insertInto('partners')
      .values({
        partner_id: input.partner_id,
        org_id: input.org_id,
        partner_code: input.partner_code,
        type: input.type,
        legal_name: input.legal_name,
        branch_id: input.branch_id,
        products: JSON.stringify(input.products),
        contact_person: input.contact_person,
        contact_mobile: input.contact_mobile,
        status: 'active',
        agreement_ref: input.agreement_ref,
        commission_flag: input.commission_flag,
        mapped_rm_id: input.mapped_rm_id,
        risk_category: input.risk_category,
        valid_until: input.valid_until,
        created_by: input.actor_id,
        updated_by: input.actor_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Partial update, org-scoped. Returns the updated row, or undefined if absent. */
  async update(
    partnerId: string,
    orgId: string,
    changes: PartnerChanges,
    actorId: string,
    tx: DbTransaction,
  ): Promise<PartnerRow | undefined> {
    return tx
      .updateTable('partners')
      .set({ ...(changes as UpdateObject<DB, 'partners'>), updated_by: actorId, updated_at: new Date() })
      .where('partner_id', '=', partnerId)
      .where('org_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();
  }
}
