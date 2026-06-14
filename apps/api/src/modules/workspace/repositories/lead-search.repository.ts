import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type { LeadStage, ProductCode, ScopePredicate } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../../core/db';
import { leadListBase, LeadScopeService } from '../lead-scope.service';

/** Top-N cap (FR-054 LLD §Data Operations — LIMIT 5 per entity type). */
const SEARCH_LIMIT = 5;

/** PAN regex — detect if `q` looks like a raw PAN so we can do token-equality lookup. */
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** ILIKE-safe escape: replaces `%` and `_` with their escaped forms. */
function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export interface LeadSearchRow {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  product_code: ProductCode;
  applicant_name: string;
  mobile: string;
  pan_masked: string | null;
  owner_id: string;
  branch_id: string | null;
  created_at: Date;
}

/**
 * FR-054 — Kysely query for the lead bucket in global search.
 * Searches across lead_code prefix, name (trigram), mobile (equality),
 * pan_token (equality), gstin (equality), los_application_id (equality).
 * Scope-filtered IN SQL via LeadScopeService (deny-by-default on unknown predicate).
 * Fully parameterised — no string interpolation of user input.
 */
@Injectable()
export class LeadSearchRepository {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly scope: LeadScopeService,
  ) {}

  async search(
    q: string,
    predicate: ScopePredicate | undefined,
    orgId: string,
  ): Promise<LeadSearchRow[]> {
    const prefix = `${escapeLike(q)}%`;
    // Only attempt PAN token lookup if q matches the PAN regex.
    const isPan = PAN_REGEX.test(q);

    let qb = this.scope
      .applyScope(leadListBase(this.db, orgId), predicate)
      .where((eb) =>
        eb.or([
          // lead_code prefix match (ILIKE with escaped literal)
          eb('l.lead_code', 'ilike', prefix),
          // trigram similarity on applicant name
          eb(sql`similarity(li.name, ${q})`, '>', sql`0.3`),
          // exact mobile match
          eb('li.mobile', '=', q),
          // exact GSTIN match
          eb('li.gstin', '=', q),
          // exact LOS application id match
          eb('l.los_application_id', '=', q),
          // PAN token equality (only when input looks like a raw PAN)
          ...(isPan ? [eb('li.pan_token', '=', q)] : []),
        ]),
      )
      .select([
        'l.lead_id',
        'l.lead_code',
        'l.stage',
        'l.product_code',
        'l.owner_id',
        'l.branch_id',
        'l.created_at',
        'li.name as applicant_name',
        'li.mobile',
        'li.pan_masked',
      ])
      .orderBy(sql`similarity(li.name, ${q})`, 'desc')
      .orderBy('l.created_at', 'desc')
      .limit(SEARCH_LIMIT);

    return qb.execute() as Promise<LeadSearchRow[]>;
  }
}
