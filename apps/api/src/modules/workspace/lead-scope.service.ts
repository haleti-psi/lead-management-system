import { Injectable } from '@nestjs/common';

import type { ScopePredicate } from '@lms/shared';

import type { DbTransaction, KyselyDb } from '../../core/db';

/**
 * The canonical workspace lead-list FROM/JOIN shape (FR-050 LLD §Data
 * Operations step 1): active leads joined to their identity (search/masked
 * display), source attribution (source/partner filter) and — via the
 * attribution — the partner row (partner-code filter + free-text search).
 * Reused by every workspace read (list, bulk re-scope; FR-051/052/053 later).
 */
export function leadListBase(db: KyselyDb | DbTransaction, orgId: string) {
  return db
    .selectFrom('leads as l')
    .innerJoin('lead_identities as li', 'li.lead_identity_id', 'l.lead_identity_id')
    .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
    .leftJoin('partners as p', 'p.partner_id', 'sa.partner_id')
    .where('l.org_id', '=', orgId)
    .where('l.deleted_at', 'is', null);
}
export type LeadListBaseQuery = ReturnType<typeof leadListBase>;

/**
 * FR-050 — compiles the caller's AbacGuard-resolved `view_lead` scope into the
 * SQL `WHERE` so no out-of-scope row is ever read (LLD §Data Operations step
 * 2 — "NEVER skipped"; scope is enforced in SQL, never post-filtered).
 *
 * Per FR-002/CORRECTIONS the team scope is `leads.owner_id IN (team member
 * user_ids)` (the predicate carries the member ids), NOT `leads.team_id`.
 * `all`/`masked` add no row predicate (org filter is already on the base
 * query; DPO's `masked` scope is force-masked at serialisation, not row-cut).
 * A missing/unknown predicate compiles to `FALSE` — deny-by-default.
 */
@Injectable()
export class LeadScopeService {
  applyScope(qb: LeadListBaseQuery, predicate: ScopePredicate | undefined): LeadListBaseQuery {
    if (!predicate) {
      return qb.where((eb) => eb.val(false));
    }
    switch (predicate.type) {
      case 'own':
        return qb.where('l.owner_id', '=', predicate.userId);
      case 'team':
        return predicate.userIds.length > 0
          ? qb.where('l.owner_id', 'in', [...predicate.userIds])
          : qb.where((eb) => eb.val(false));
      case 'branch':
        return qb.where('l.branch_id', '=', predicate.branchId);
      case 'region':
        return predicate.branchIds.length > 0
          ? qb.where('l.branch_id', 'in', [...predicate.branchIds])
          : qb.where((eb) => eb.val(false));
      case 'all':
      case 'masked':
        return qb;
      case 'partner':
        return qb.where('sa.partner_id', '=', predicate.partnerId);
      case 'customer_token':
        return qb.where('l.lead_id', '=', predicate.leadId);
      default:
        return qb.where((eb) => eb.val(false));
    }
  }
}
