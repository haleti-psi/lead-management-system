import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { RightsStatus, RightsType } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { DataRightsRequests } from '../../core/db/types.generated';
import { DomainException } from '../../core/http';
import { DATA_RIGHTS_LIST_MAX_LIMIT } from './data-rights.constants';
import type { ListDataRightsQuery } from './dto/list-data-rights.dto';

export type DataRightsRow = Selectable<DataRightsRequests>;

/** Insert shape for a new data-rights-request row (LLD §Data Operations — Insert). */
export interface NewDataRightsRequest {
  data_rights_request_id: string;
  org_id: string;
  customer_profile_id: string;
  lead_id: string | null;
  request_type: RightsType;
  status: RightsStatus;
  owner_id: string | null;
  due_at: Date | null;
  disposition: string | null;
  created_by: string;
  updated_by: string;
}

/** Input for the paginated list query. */
export interface DataRightsListInput {
  orgId: string;
  query: ListDataRightsQuery;
}

/**
 * FR-112 — Kysely-backed repository for `data_rights_requests`.
 * M12 is the SOLE writer of this table (owner-writes §11).
 * All reads are parameterised and LIMIT-bounded (NFR-17).
 */
@Injectable()
export class DataRightsRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Fetch a single data-rights request by ID scoped to `org_id`.
   * Returns `undefined` when not found (existence hidden).
   */
  async findById(requestId: string, orgId: string): Promise<DataRightsRow | undefined> {
    return this.db
      .selectFrom('data_rights_requests')
      .selectAll()
      .where('data_rights_request_id', '=', requestId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Same as {@link findById} but throws NOT_FOUND when absent.
   */
  async findByIdOrThrow(requestId: string, orgId: string): Promise<DataRightsRow> {
    const row = await this.findById(requestId, orgId);
    if (!row) throw new DomainException('NOT_FOUND');
    return row;
  }

  /**
   * Paginated list of data-rights requests scoped to org (DPO sees all).
   * Returns `{ rows, total }` for the envelope meta.
   */
  async list(input: DataRightsListInput): Promise<{ rows: DataRightsRow[]; total: number }> {
    const { orgId, query } = input;
    const limit = Math.min(query.limit, DATA_RIGHTS_LIST_MAX_LIMIT);
    const offset = (query.page - 1) * limit;

    // Base query — org-scoped
    let q = this.db
      .selectFrom('data_rights_requests')
      .where('org_id', '=', orgId);

    if (query.status !== undefined) {
      q = q.where('status', '=', query.status);
    }
    if (query.request_type !== undefined) {
      q = q.where('request_type', '=', query.request_type);
    }
    if (query.customer_profile_id !== undefined) {
      q = q.where('customer_profile_id', '=', query.customer_profile_id);
    }
    if (query.due_before !== undefined) {
      q = q.where('due_at', '<=', new Date(query.due_before));
    }

    const [rows, countRow] = await Promise.all([
      q
        .selectAll()
        .orderBy('due_at', 'asc')
        .limit(limit)
        .offset(offset)
        .execute(),
      q
        .select((eb) =>
          eb.fn.count<string>('data_rights_request_id').as('total'),
        )
        .executeTakeFirst(),
    ]);

    return { rows, total: Number(countRow?.total ?? 0) };
  }

  /**
   * Insert a new request row inside `tx`. Returns the inserted row.
   * Caller must be inside a UnitOfWork transaction.
   */
  async insert(row: NewDataRightsRequest, tx: DbTransaction): Promise<DataRightsRow> {
    return tx
      .insertInto('data_rights_requests')
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Update request fields inside `tx`. Returns the updated row.
   */
  async update(
    requestId: string,
    orgId: string,
    patch: {
      status: RightsStatus;
      disposition?: string | null;
      owner_id?: string | null;
      updated_by: string;
    },
    tx: DbTransaction,
  ): Promise<DataRightsRow> {
    return tx
      .updateTable('data_rights_requests')
      .set({
        status: patch.status,
        ...(patch.disposition !== undefined && { disposition: patch.disposition }),
        ...(patch.owner_id !== undefined && { owner_id: patch.owner_id }),
        updated_by: patch.updated_by,
      })
      .where('data_rights_request_id', '=', requestId)
      .where('org_id', '=', orgId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Legal-hold check: returns true if any active retention policy has legal_hold=true
   * for this org (LLD §Legal-hold check — conservative org-wide check per Ambiguity #2).
   */
  async hasActiveLegalHold(orgId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('retention_policies')
      .select('retention_policy_id')
      .where('org_id', '=', orgId)
      .where('legal_hold', '=', true)
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }
}
