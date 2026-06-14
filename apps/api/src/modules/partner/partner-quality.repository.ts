import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type { LeadStage } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import { CONTACTABLE_STAGES, DUPLICATE_STATUSES } from './partner.constants';

export interface LeadCounts {
  total_leads: number;
  contactable_leads: number;
  duplicate_leads: number;
  rejected_leads: number;
  handed_off_leads: number;
}

export interface DocCounts {
  uploaded_docs: number;
  verified_docs_first_time: number;
}

/**
 * FR-092 — partner quality aggregate reads (M10). Pure reads over
 * leads/source_attributions/documents/kyc_verifications, partner- and window-
 * scoped. The TAT medians use a parameterised raw `sql` query (a nested aggregate
 * Kysely's builder can't express — LLD Assumption 2; AVG approximation).
 */
@Injectable()
export class PartnerQualityRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async getLeadCounts(orgId: string, partnerId: string, fromTs: Date, toTs: Date): Promise<LeadCounts> {
    const contactable = [...CONTACTABLE_STAGES] as LeadStage[];
    const dupStatuses = [...DUPLICATE_STATUSES];
    const row = await this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .select((eb) => [
        eb.fn.count('l.lead_id').as('total_leads'),
        eb.fn.count('l.lead_id').filterWhere('l.stage', 'in', contactable).as('contactable_leads'),
        eb.fn.count('l.lead_id').filterWhere('l.duplicate_status', 'in', dupStatuses).as('duplicate_leads'),
        eb.fn.count('l.lead_id').filterWhere('l.stage', '=', 'rejected').as('rejected_leads'),
        eb.fn.count('l.lead_id').filterWhere('l.stage', '=', 'handed_off').as('handed_off_leads'),
      ])
      .where('l.org_id', '=', orgId)
      .where('sa.partner_id', '=', partnerId)
      .where('l.created_at', '>=', fromTs)
      .where('l.created_at', '<=', toTs)
      .where('l.deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return {
      total_leads: Number(row.total_leads),
      contactable_leads: Number(row.contactable_leads),
      duplicate_leads: Number(row.duplicate_leads),
      rejected_leads: Number(row.rejected_leads),
      handed_off_leads: Number(row.handed_off_leads),
    };
  }

  async getDocCounts(orgId: string, partnerId: string, fromTs: Date, toTs: Date): Promise<DocCounts> {
    const row = await this.db
      .selectFrom('documents as d')
      .innerJoin('leads as l', 'l.lead_id', 'd.lead_id')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .select((eb) => [
        eb.fn.count('d.document_id').filterWhere('d.status', '!=', 'pending').as('uploaded_docs'),
        eb.fn
          .count('d.document_id')
          .filterWhere('d.status', '=', 'verified')
          .filterWhere('d.version', '=', 1)
          .as('verified_docs_first_time'),
      ])
      .where('l.org_id', '=', orgId)
      .where('sa.partner_id', '=', partnerId)
      .where('l.created_at', '>=', fromTs)
      .where('l.created_at', '<=', toTs)
      .where('l.deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return {
      uploaded_docs: Number(row.uploaded_docs),
      verified_docs_first_time: Number(row.verified_docs_first_time),
    };
  }

  async getKycMismatchLeads(orgId: string, partnerId: string, fromTs: Date, toTs: Date): Promise<number> {
    const row = await this.db
      .selectFrom('kyc_verifications as kv')
      .innerJoin('leads as l', 'l.lead_id', 'kv.lead_id')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .select((eb) => eb.fn.count('l.lead_id').distinct().as('n'))
      .where('l.org_id', '=', orgId)
      .where('sa.partner_id', '=', partnerId)
      .where('kv.status', '=', 'failed')
      .where('l.created_at', '>=', fromTs)
      .where('l.created_at', '<=', toTs)
      .where('l.deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** This partner's avg doc TAT (hours): avg over leads of (first doc upload − created_at). */
  async getThisPartnerAvgTatHours(
    orgId: string,
    partnerId: string,
    fromTs: Date,
    toTs: Date,
  ): Promise<number | null> {
    const result = await sql<{ tat: number | null }>`
      SELECT avg(t.tat) AS tat FROM (
        SELECT extract(epoch FROM (min(d.updated_at) - l.created_at)) / 3600.0 AS tat
        FROM leads l
        JOIN source_attributions sa ON sa.source_attribution_id = l.source_attribution_id
        JOIN documents d ON d.lead_id = l.lead_id
        WHERE l.org_id = ${orgId} AND sa.partner_id = ${partnerId}
          AND d.status <> 'pending' AND l.deleted_at IS NULL
          AND l.created_at >= ${fromTs} AND l.created_at <= ${toTs}
        GROUP BY l.lead_id
      ) t
    `.execute(this.db);
    const tat = result.rows[0]?.tat;
    return tat == null ? null : Number(tat);
  }

  /** Minimum per-partner avg doc TAT (hours) across the org — the speed-index numerator. */
  async getAllPartnersMinAvgTatHours(orgId: string, fromTs: Date, toTs: Date): Promise<number | null> {
    const result = await sql<{ min_tat: number | null }>`
      SELECT min(p.avg_tat) AS min_tat FROM (
        SELECT t.partner_id, avg(t.tat) AS avg_tat FROM (
          SELECT sa.partner_id AS partner_id,
                 extract(epoch FROM (min(d.updated_at) - l.created_at)) / 3600.0 AS tat
          FROM leads l
          JOIN source_attributions sa ON sa.source_attribution_id = l.source_attribution_id
          JOIN documents d ON d.lead_id = l.lead_id
          WHERE l.org_id = ${orgId} AND sa.partner_id IS NOT NULL
            AND d.status <> 'pending' AND l.deleted_at IS NULL
            AND l.created_at >= ${fromTs} AND l.created_at <= ${toTs}
          GROUP BY sa.partner_id, l.lead_id
        ) t
        GROUP BY t.partner_id
      ) p
    `.execute(this.db);
    const tat = result.rows[0]?.min_tat;
    return tat == null ? null : Number(tat);
  }

  /** Best-effort cache write of the computed score (single-table UPDATE; LLD §F). */
  async updateQualityScore(partnerId: string, orgId: string, score: number, actorId: string): Promise<void> {
    await this.db
      .updateTable('partners')
      .set({ quality_score: score, updated_by: actorId, updated_at: new Date() })
      .where('partner_id', '=', partnerId)
      .where('org_id', '=', orgId)
      .execute();
  }
}
