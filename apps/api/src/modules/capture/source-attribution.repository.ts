import { Injectable } from '@nestjs/common';

import { AttributionStatus, type CreationChannel, type LeadSource } from '@lms/shared';

import type { DbTransaction } from '../../core/db';

/** Values written by {@link SourceAttributionRepository.insert} (FR-010 step E3). */
export interface InsertSourceAttributionValues {
  org_id: string;
  source: LeadSource;
  sub_source: string | null;
  partner_id: string | null;
  campaign_code: string | null;
  utm: Record<string, unknown> | null;
  creator_channel: CreationChannel;
  created_by: string;
}

/**
 * FR-010 — Kysely writes for `source_attributions` (M2-owned). One row per lead
 * at capture with `attribution_status='original'`; reassignment/merge histories
 * are owned by FR-021/FR-030.
 */
@Injectable()
export class SourceAttributionRepository {
  async insert(values: InsertSourceAttributionValues, tx: DbTransaction): Promise<string> {
    const row = await tx
      .insertInto('source_attributions')
      .values({
        org_id: values.org_id,
        source: values.source,
        sub_source: values.sub_source,
        partner_id: values.partner_id,
        campaign_code: values.campaign_code,
        utm: values.utm != null ? JSON.stringify(values.utm) : null,
        creator_channel: values.creator_channel,
        attribution_status: AttributionStatus.ORIGINAL,
        created_by: values.created_by,
        updated_by: values.created_by,
      })
      .returning('source_attribution_id')
      .executeTakeFirstOrThrow();
    return row.source_attribution_id;
  }
}
