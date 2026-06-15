import { Inject, Injectable } from '@nestjs/common';

import type { LeadStage } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';

/** One partner-owned lead row (raw; name/mobile masked by the service). */
export interface PartnerLeadRow {
  lead_id: string;
  lead_code: string;
  stage: string;
  product_code: string;
  duplicate_status: string;
  created_at: Date;
  name: string;
  mobile: string;
}

export interface PartnerLeadListParams {
  page: number;
  limit: number;
  stage?: LeadStage;
  q?: string;
}

/**
 * FR-091 — partner-scoped reads over `leads` (P-scope: `source_attributions.
 * partner_id = partnerId`, non-negotiable). Reads only; the create path goes
 * through {@link CaptureService} (LeadService is the sole `leads` writer).
 */
@Injectable()
export class PartnerLeadRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async listOwn(orgId: string, partnerId: string, params: PartnerLeadListParams): Promise<PartnerLeadRow[]> {
    let q = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .innerJoin('lead_identities as li', 'li.lead_identity_id', 'l.lead_identity_id')
      .select([
        'l.lead_id as lead_id',
        'l.lead_code as lead_code',
        'l.stage as stage',
        'l.product_code as product_code',
        'l.duplicate_status as duplicate_status',
        'l.created_at as created_at',
        'li.name as name',
        'li.mobile as mobile',
      ])
      .where('l.org_id', '=', orgId)
      .where('sa.partner_id', '=', partnerId)
      .where('l.deleted_at', 'is', null);
    if (params.stage) q = q.where('l.stage', '=', params.stage);
    if (params.q) {
      const prefix = `${params.q}%`;
      q = q.where((eb) => eb.or([eb('li.mobile', 'like', prefix), eb('l.lead_code', 'like', prefix)]));
    }
    return q
      .orderBy('l.created_at', 'desc')
      .limit(params.limit)
      .offset((params.page - 1) * params.limit)
      .execute();
  }

  async countOwn(orgId: string, partnerId: string, params: PartnerLeadListParams): Promise<number> {
    let q = this.db
      .selectFrom('leads as l')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .innerJoin('lead_identities as li', 'li.lead_identity_id', 'l.lead_identity_id')
      .where('l.org_id', '=', orgId)
      .where('sa.partner_id', '=', partnerId)
      .where('l.deleted_at', 'is', null);
    if (params.stage) q = q.where('l.stage', '=', params.stage);
    if (params.q) {
      const prefix = `${params.q}%`;
      q = q.where((eb) => eb.or([eb('li.mobile', 'like', prefix), eb('l.lead_code', 'like', prefix)]));
    }
    const row = await q.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    return Number(row.n);
  }
}
