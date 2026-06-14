import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type { ScopePredicate } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../../core/db';
import type { PartnerStatus, PartnerType } from '../../../core/db/types.generated';

/** Top-N cap per entity type. */
const SEARCH_LIMIT = 5;

function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export interface PartnerSearchRow {
  partner_id: string;
  partner_code: string;
  legal_name: string;
  type: PartnerType;
  status: PartnerStatus;
}

/**
 * FR-054 — Kysely query for the partner bucket in global search.
 * Searches partner_code (prefix ILIKE) and legal_name (trigram similarity).
 * PARTNER role sees only their own partner; internal roles see all org partners.
 * No PII fields; partners table is small (tens–hundreds of rows).
 */
@Injectable()
export class PartnerSearchRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async search(
    q: string,
    predicate: ScopePredicate | undefined,
    orgId: string,
  ): Promise<PartnerSearchRow[]> {
    const prefix = `${escapeLike(q)}%`;

    let qb = this.db
      .selectFrom('partners')
      .where('org_id', '=', orgId)
      .where((eb) =>
        eb.or([
          eb('partner_code', 'ilike', prefix),
          eb(sql`similarity(legal_name, ${q})`, '>', sql`0.3`),
        ]),
      )
      .select(['partner_id', 'partner_code', 'legal_name', 'type', 'status'])
      .orderBy(sql`similarity(legal_name, ${q})`, 'desc')
      .limit(SEARCH_LIMIT);

    // PARTNER scope: restrict to their own partner record only.
    if (predicate?.type === 'partner') {
      qb = qb.where('partner_id', '=', predicate.partnerId);
    }

    return qb.execute() as Promise<PartnerSearchRow[]>;
  }
}
