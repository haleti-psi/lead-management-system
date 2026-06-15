import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { MirrorSource } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { SYSTEM_USER_ID } from '../../core/integration/integration.constants';

/** Projection used by service consumers. */
export interface MirrorRow {
  los_mirror_id: string;
  lead_id: string;
  los_application_id: string;
  status: string;
  status_date: Date;
  correlation_id: string | null;
  received_via: MirrorSource;
  created_at: Date;
  updated_at: Date;
}

/**
 * FR-082 — Kysely repository for `los_application_mirrors`. M9 is the sole
 * writer of this table. All queries are parameterised (no raw SQL interpolation).
 *
 * Idempotency / out-of-order protection lives in the upsert's WHERE clause: the
 * UPDATE only fires when `excluded.status_date > los_application_mirrors.status_date`.
 */
@Injectable()
export class LosApplicationMirrorRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Upsert the mirror row for a given `los_application_id`.
   *
   * On conflict (unique key on `los_application_id`):
   *   - Update status/status_date/correlation_id/received_via ONLY IF the
   *     incoming `status_date` is strictly newer than the stored one.
   *   - If incoming is older (out-of-order), the UPDATE is a no-op; the INSERT
   *     part is skipped by the conflict handler. HTTP 200 is still returned.
   */
  async upsertMirror(
    input: {
      orgId: string;
      leadId: string;
      losApplicationId: string;
      status: string;
      statusDate: Date;
      correlationId: string | null;
      receivedVia: MirrorSource;
    },
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .insertInto('los_application_mirrors')
      .values({
        los_mirror_id: randomUUID(),
        org_id: input.orgId,
        lead_id: input.leadId,
        los_application_id: input.losApplicationId,
        status: input.status,
        status_date: input.statusDate,
        correlation_id: input.correlationId,
        received_via: input.receivedVia,
        created_by: SYSTEM_USER_ID,
        updated_by: SYSTEM_USER_ID,
      })
      .onConflict((oc) =>
        oc.column('los_application_id').doUpdateSet((eb) => ({
          status: eb.ref('excluded.status'),
          status_date: eb.ref('excluded.status_date'),
          correlation_id: eb.ref('excluded.correlation_id'),
          received_via: eb.ref('excluded.received_via'),
          updated_by: SYSTEM_USER_ID,
          updated_at: new Date(),
        })).where(
          (eb) => eb('excluded.status_date', '>', eb.ref('los_application_mirrors.status_date')),
        ),
      )
      .execute();
  }

  /**
   * Find all mirror rows for a lead ordered newest-first (max 25).
   * Called by the workspace Lead 360 read endpoint (view_lead guard applies there).
   */
  async findByLeadId(leadId: string, orgId: string): Promise<MirrorRow[]> {
    const rows = await this.db
      .selectFrom('los_application_mirrors')
      .selectAll()
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .orderBy('status_date', 'desc')
      .limit(25)
      .execute();

    return rows.map((r) => ({
      los_mirror_id: r.los_mirror_id,
      lead_id: r.lead_id,
      los_application_id: r.los_application_id,
      status: r.status,
      status_date: r.status_date instanceof Date ? r.status_date : new Date(r.status_date as unknown as string),
      correlation_id: r.correlation_id,
      received_via: r.received_via,
      created_at: r.created_at instanceof Date ? r.created_at : new Date(r.created_at as unknown as string),
      updated_at: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at as unknown as string),
    }));
  }

  /**
   * Find up to 100 leads in `handed_off` stage whose mirror is stale (or absent).
   * Used by the reconciliation job (FR-082 §14.7).
   *
   * Returns (lead_id, los_application_id, org_id) tuples — org_id is threaded so the
   * reconcile job can attribute any failure integration_log to the correct org.
   */
  async findStaleHandedOffLeads(
    staleThresholdDate: Date,
  ): Promise<Array<{ lead_id: string; los_application_id: string; org_id: string }>> {
    // Leads in handed_off that either have no mirror row OR whose mirror status_date
    // is older than staleThresholdDate.
    const rows = await this.db
      .selectFrom('leads')
      .innerJoin('los_application_mirrors', 'los_application_mirrors.lead_id', 'leads.lead_id')
      .select(['leads.lead_id', 'leads.los_application_id', 'leads.org_id'])
      .where('leads.stage', '=', 'handed_off')
      .where('leads.los_application_id', 'is not', null)
      .where('leads.deleted_at', 'is', null)
      .where('los_application_mirrors.status_date', '<', staleThresholdDate)
      .limit(100)
      .execute();

    // Also find handed_off leads with NO mirror row yet.
    const rowsNoMirror = await this.db
      .selectFrom('leads')
      .leftJoin('los_application_mirrors', 'los_application_mirrors.lead_id', 'leads.lead_id')
      .select(['leads.lead_id', 'leads.los_application_id', 'leads.org_id'])
      .where('leads.stage', '=', 'handed_off')
      .where('leads.los_application_id', 'is not', null)
      .where('leads.deleted_at', 'is', null)
      .where('los_application_mirrors.los_mirror_id', 'is', null)
      .limit(100)
      .execute();

    const combined = [...rows, ...rowsNoMirror];
    // Deduplicate by lead_id.
    const seen = new Set<string>();
    const deduped: Array<{ lead_id: string; los_application_id: string; org_id: string }> = [];
    for (const row of combined) {
      if (!seen.has(row.lead_id) && row.los_application_id !== null) {
        seen.add(row.lead_id);
        deduped.push({ lead_id: row.lead_id, los_application_id: row.los_application_id, org_id: row.org_id });
      }
    }
    // Enforce the LIMIT 100 after dedup.
    return deduped.slice(0, 100);
  }
}
