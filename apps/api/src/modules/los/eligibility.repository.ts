import { Inject, Injectable } from '@nestjs/common';
import type { Selectable, Updateable } from 'kysely';

import type { EligibilityStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { EligibilitySnapshots } from '../../core/db/types.generated';

/** The columns we project from `eligibility_snapshots` on read/insert. */
type SnapshotProjection = Selectable<EligibilitySnapshots>;

/** Minimal eligibility snapshot projection returned to callers. */
export interface EligibilitySnapshotRow {
  eligibility_snapshot_id: string;
  lead_id: string;
  org_id: string;
  request_ref: string;
  status: EligibilityStatus;
  indicative_amount: string | null;
  tenure_months: number | null;
  rate_range: string | null;
  conditions: unknown | null;
  validity_until: Date | null;
  response_basis: string | null;
  created_at: Date;
}

/** The subset of fields set on a successful LOS response. */
export interface EligibilitySnapshotUpdate {
  status: EligibilityStatus;
  indicative_amount?: string | null;
  tenure_months?: number | null;
  rate_range?: string | null;
  conditions?: Record<string, unknown> | null;
  validity_until?: Date | null;
  response_basis?: string | null;
}

/**
 * FR-080 — Kysely repository for `eligibility_snapshots`. M9 is the sole writer
 * of this table; all reads / writes are parameterised.
 */
@Injectable()
export class EligibilityRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Insert a new eligibility snapshot row (status = pending) within the caller's tx.
   */
  async insertSnapshot(
    input: {
      org_id: string;
      lead_id: string;
      request_ref: string;
      created_by: string;
    },
    tx: DbTransaction,
  ): Promise<EligibilitySnapshotRow> {
    const now = new Date();
    const row = await tx
      .insertInto('eligibility_snapshots')
      .values({
        org_id: input.org_id,
        lead_id: input.lead_id,
        request_ref: input.request_ref,
        status: 'pending',
        created_by: input.created_by,
        updated_by: input.created_by,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.toRow(row);
  }

  /**
   * Update a snapshot's status + LOS response fields (post-commit, no open tx).
   */
  async updateSnapshotStatus(
    snapshotId: string,
    orgId: string,
    update: EligibilitySnapshotUpdate,
    actorId: string,
  ): Promise<void> {
    const setValues: Updateable<EligibilitySnapshots> = {
      status: update.status,
      updated_at: new Date(),
      updated_by: actorId,
    };

    if (update.indicative_amount !== undefined) {
      // Numeric column: Updateable accepts string | number | null
      setValues.indicative_amount = update.indicative_amount;
    }
    if (update.tenure_months !== undefined) {
      setValues.tenure_months = update.tenure_months ?? null;
    }
    if (update.rate_range !== undefined) {
      setValues.rate_range = update.rate_range ?? null;
    }
    if (update.conditions !== undefined) {
      setValues.conditions = (update.conditions as unknown as never) ?? null;
    }
    if (update.validity_until !== undefined) {
      setValues.validity_until = update.validity_until ?? null;
    }
    if (update.response_basis !== undefined) {
      setValues.response_basis = update.response_basis ?? null;
    }

    await this.db
      .updateTable('eligibility_snapshots')
      .set(setValues)
      .where('eligibility_snapshot_id', '=', snapshotId)
      .where('org_id', '=', orgId)
      .execute();
  }

  /**
   * Find an existing eligibility snapshot by request_ref (for idempotent replay).
   */
  async findSnapshotByRequestRef(
    requestRef: string,
    orgId: string,
  ): Promise<EligibilitySnapshotRow | undefined> {
    const row = await this.db
      .selectFrom('eligibility_snapshots')
      .selectAll()
      .where('request_ref', '=', requestRef)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();

    return row ? this.toRow(row) : undefined;
  }

  private toRow(row: SnapshotProjection): EligibilitySnapshotRow {
    const indicativeAmount = row.indicative_amount;
    const validityUntil = row.validity_until;
    const createdAt = row.created_at;

    return {
      eligibility_snapshot_id: row.eligibility_snapshot_id,
      lead_id: row.lead_id,
      org_id: row.org_id,
      request_ref: row.request_ref,
      status: row.status,
      indicative_amount: typeof indicativeAmount === 'string' ? indicativeAmount : null,
      tenure_months: row.tenure_months ?? null,
      rate_range: row.rate_range ?? null,
      conditions: row.conditions ?? null,
      validity_until: validityUntil instanceof Date
        ? validityUntil
        : validityUntil != null
          ? new Date(validityUntil as unknown as string)
          : null,
      response_basis: row.response_basis ?? null,
      created_at: createdAt instanceof Date
        ? createdAt
        : new Date(createdAt as unknown as string),
    };
  }
}
