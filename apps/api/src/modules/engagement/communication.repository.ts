import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { CommunicationLogs } from '../../core/db/types.generated';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';

export type CommLogRow = Selectable<CommunicationLogs>;

export interface InsertCommLogParams {
  lead_id: string;
  template_id: string;
  channel: CommLogRow['channel'];
  recipient: string;
  consent_basis: CommLogRow['consent_basis'];
  created_by: string;
}

/**
 * FR-101 — Repository for communication_logs (M11 sole writer).
 * All queries scoped to ORG_ID_DEFAULT.
 */
@Injectable()
export class CommunicationRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Insert a new communication_log row with status = 'queued'. */
  async insert(params: InsertCommLogParams, tx?: DbTransaction): Promise<CommLogRow> {
    const db: KyselyDb = tx ?? this.db;
    return db
      .insertInto('communication_logs')
      .values({
        communication_log_id: randomUUID(),
        org_id: ORG_ID_DEFAULT,
        lead_id: params.lead_id,
        template_id: params.template_id,
        channel: params.channel,
        recipient: params.recipient,
        consent_basis: params.consent_basis,
        status: 'queued',
        created_by: params.created_by,
        updated_by: params.created_by,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Update delivery status on provider callback (delivery worker / webhook).
   * Does NOT open a transaction — the caller wraps if needed.
   */
  async updateStatus(
    logId: string,
    update: {
      status: 'sent' | 'delivered' | 'failed';
      provider_ref?: string | null;
      failure_reason?: string | null;
      sent_at?: Date | null;
      updated_by: string;
    },
    tx?: DbTransaction,
  ): Promise<void> {
    const db: KyselyDb = tx ?? this.db;
    await db
      .updateTable('communication_logs')
      .set({
        status: update.status,
        provider_ref: update.provider_ref ?? null,
        failure_reason: update.failure_reason ?? null,
        sent_at: update.sent_at ?? null,
        updated_by: update.updated_by,
      })
      .where('communication_log_id', '=', logId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .execute();
  }

  /** Fetch a log row by id (for worker idempotency check). */
  async findById(logId: string, tx?: DbTransaction): Promise<CommLogRow | undefined> {
    const db: KyselyDb = tx ?? this.db;
    return db
      .selectFrom('communication_logs')
      .selectAll()
      .where('communication_log_id', '=', logId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * List communication logs for a lead — paginated, org-scoped.
   * Masked: recipient is omitted from projection (callers must not return raw PII).
   */
  async listByLead(
    leadId: string,
    orgId: string,
    pagination: { page: number; limit: number },
  ): Promise<{ rows: CommLogRow[]; total: number }> {
    const { page, limit } = pagination;

    const baseQuery = this.db
      .selectFrom('communication_logs')
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId);

    const countResult = await baseQuery
      .select((eb) => eb.fn.count<string>('communication_log_id').as('cnt'))
      .executeTakeFirst();
    const total = parseInt(countResult?.cnt ?? '0', 10);

    const rows = await baseQuery
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();

    return { rows, total };
  }
}
