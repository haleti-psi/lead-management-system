import { Inject, Injectable } from '@nestjs/common';

import { MirrorSource } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';

/** Minimal mirror row projection returned to callers. */
export interface LosApplicationMirrorRow {
  los_mirror_id: string;
  lead_id: string;
  los_application_id: string;
  status: string;
  status_date: Date;
  created_at: Date;
}

/**
 * FR-081 — Kysely repository for `los_application_mirrors`. M9 is the sole
 * writer of this table. All reads/writes are parameterised (no raw interpolation).
 */
@Injectable()
export class LosRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Insert the initial LOS application mirror row (status='submitted') in the
   * caller's UoW transaction. FR-082 will upsert the real status on webhook.
   */
  async insertMirror(
    input: {
      orgId: string;
      leadId: string;
      losApplicationId: string;
      correlationId: string;
      actorId: string;
    },
    tx: DbTransaction,
  ): Promise<LosApplicationMirrorRow> {
    const now = new Date();
    const row = await tx
      .insertInto('los_application_mirrors')
      .values({
        org_id: input.orgId,
        lead_id: input.leadId,
        los_application_id: input.losApplicationId,
        status: 'submitted',
        status_date: now,
        correlation_id: input.correlationId,
        received_via: MirrorSource.WEBHOOK, // placeholder; FR-082 upserts real value
        created_by: input.actorId,
        updated_by: input.actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      los_mirror_id: row.los_mirror_id,
      lead_id: row.lead_id,
      los_application_id: row.los_application_id,
      status: row.status,
      status_date:
        row.status_date instanceof Date ? row.status_date : new Date(row.status_date as unknown as string),
      created_at:
        row.created_at instanceof Date ? row.created_at : new Date(row.created_at as unknown as string),
    };
  }

  /**
   * Find an existing mirror row by lead_id (for idempotent replay checks).
   */
  async findMirrorByLeadId(
    leadId: string,
    orgId: string,
  ): Promise<LosApplicationMirrorRow | undefined> {
    const row = await this.db
      .selectFrom('los_application_mirrors')
      .selectAll()
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();

    if (!row) return undefined;

    return {
      los_mirror_id: row.los_mirror_id,
      lead_id: row.lead_id,
      los_application_id: row.los_application_id,
      status: row.status,
      status_date:
        row.status_date instanceof Date ? row.status_date : new Date(row.status_date as unknown as string),
      created_at:
        row.created_at instanceof Date ? row.created_at : new Date(row.created_at as unknown as string),
    };
  }
}
