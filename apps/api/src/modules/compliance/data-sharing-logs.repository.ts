import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { ConsentPurpose, DataCategory, ShareStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { DataSharingLogs } from '../../core/db/types.generated';

/** Read shape of a `data_sharing_logs` row. */
export type DataSharingLogRow = Selectable<DataSharingLogs>;

/**
 * FR-111 — read repository for `data_sharing_logs`. This table is append-only
 * (architecture §11.1; auth-matrix `data_sharing_logs.writer = owning
 * service/jobs`). Inserts are done by {@link DataSharingService} within the
 * caller's UnitOfWork transaction. This repository exposes only reads.
 */
@Injectable()
export class DataSharingLogsRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Paginated list of data-sharing log rows for a lead, ordered by
   * `shared_at DESC` (DPO oversight view — LLD §Data Operations 1).
   * LIMIT ≤ 100 enforced via the pagination DTO (performance.md NFR).
   */
  async findByLeadId(
    leadId: string,
    orgId: string,
    pagination: { page: number; limit: number },
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<DataSharingLogRow[]> {
    const offset = (pagination.page - 1) * pagination.limit;
    return executor
      .selectFrom('data_sharing_logs')
      .selectAll()
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .orderBy('shared_at', 'desc')
      .limit(pagination.limit)
      .offset(offset)
      .execute();
  }

  /**
   * Total matching rows for pagination meta — same WHERE as the page query.
   */
  async countByLeadId(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<number> {
    const row = await executor
      .selectFrom('data_sharing_logs')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }
}

/** Insert shape for one append-only data-sharing log row. */
export interface NewDataSharingLog {
  leadId: string;
  orgId: string;
  recipient: string;
  purpose: ConsentPurpose;
  dataCategory: DataCategory;
  consentId: string | null;
  status: ShareStatus;
  sharedAt: Date;
  actorId: string;
}
