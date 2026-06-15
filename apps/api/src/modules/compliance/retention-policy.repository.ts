import { Inject, Injectable } from '@nestjs/common';

import type { DataCategory, LeadOutcome, RetentionAction } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { RetentionPolicyDto } from './retention-policy.dto';

export interface RetentionPolicyRow {
  retention_policy_id: string;
  org_id: string;
  data_category: DataCategory;
  lead_outcome: LeadOutcome | null;
  retain_days: number;
  action: RetentionAction;
  legal_hold: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
}

export interface ListRetentionPoliciesOptions {
  orgId: string;
  data_category?: DataCategory;
  action?: RetentionAction;
  is_active?: boolean;
  page: number;
  limit: number;
}

export interface CreateRetentionPolicyInput {
  org_id: string;
  data_category: DataCategory;
  lead_outcome: LeadOutcome | null;
  retain_days: number;
  action: RetentionAction;
  legal_hold: boolean;
  created_by: string;
  updated_by: string;
}

export function rowToDto(row: RetentionPolicyRow): RetentionPolicyDto {
  return {
    retention_policy_id: row.retention_policy_id,
    data_category: row.data_category,
    lead_outcome: row.lead_outcome,
    retain_days: row.retain_days,
    action: row.action,
    legal_hold: row.legal_hold,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * M12 sole reader/writer for `retention_policies`.
 * All list queries are LIMIT-bounded; writes are handled in the service's UnitOfWork.
 */
@Injectable()
export class RetentionPolicyRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async list(opts: ListRetentionPoliciesOptions): Promise<{ rows: RetentionPolicyRow[]; total: number }> {
    let query = this.db
      .selectFrom('retention_policies')
      .selectAll()
      .where('org_id', '=', opts.orgId);

    if (opts.data_category !== undefined) {
      query = query.where('data_category', '=', opts.data_category);
    }
    if (opts.action !== undefined) {
      query = query.where('action', '=', opts.action);
    }
    if (opts.is_active !== undefined) {
      query = query.where('is_active', '=', opts.is_active);
    }

    let countQuery = this.db
      .selectFrom('retention_policies')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('org_id', '=', opts.orgId);

    if (opts.data_category !== undefined) {
      countQuery = countQuery.where('data_category', '=', opts.data_category);
    }
    if (opts.action !== undefined) {
      countQuery = countQuery.where('action', '=', opts.action);
    }
    if (opts.is_active !== undefined) {
      countQuery = countQuery.where('is_active', '=', opts.is_active);
    }

    const [rows, countRow] = await Promise.all([
      query
        .orderBy('created_at', 'desc')
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit)
        .execute(),
      countQuery.executeTakeFirst(),
    ]);

    return {
      rows: rows as unknown as RetentionPolicyRow[],
      total: parseInt(countRow?.n ?? '0', 10),
    };
  }

  async create(input: CreateRetentionPolicyInput, tx?: DbTransaction): Promise<RetentionPolicyRow> {
    const executor = tx ?? this.db;
    const row = await executor
      .insertInto('retention_policies')
      .values({
        org_id: input.org_id,
        data_category: input.data_category,
        lead_outcome: input.lead_outcome,
        retain_days: input.retain_days,
        action: input.action,
        legal_hold: input.legal_hold,
        created_by: input.created_by,
        updated_by: input.updated_by,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return row as unknown as RetentionPolicyRow;
  }

  /** Return all active policies, with optional category filter. */
  async findActivePolicies(orgId: string, dataCategory?: DataCategory): Promise<RetentionPolicyRow[]> {
    let query = this.db
      .selectFrom('retention_policies')
      .selectAll()
      .where('org_id', '=', orgId)
      .where('is_active', '=', true)
      .limit(100);

    if (dataCategory !== undefined) {
      query = query.where('data_category', '=', dataCategory);
    }

    const rows = await query.execute();
    return rows as unknown as RetentionPolicyRow[];
  }

  /** Return categories that have an active legal-hold policy. */
  async findLegalHoldCategories(orgId: string): Promise<DataCategory[]> {
    const rows = await this.db
      .selectFrom('retention_policies')
      .select('data_category')
      .where('org_id', '=', orgId)
      .where('legal_hold', '=', true)
      .where('is_active', '=', true)
      .limit(100)
      .execute();

    return rows.map((r) => r.data_category as DataCategory);
  }
}
