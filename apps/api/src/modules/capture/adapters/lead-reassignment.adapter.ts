import { Injectable } from '@nestjs/common';

import type { DbTransaction } from '../../../core/db';
import type { LeadReassignPort } from '../../admin/ports/lead-reassign.port';
import { BULK_REASSIGN_MAX_IDS, TERMINAL_LEAD_STAGES } from '../capture.constants';
import { LeadService } from '../lead.service';

/**
 * FR-010 — binds the FR-130 owner-writes seam ({@link LeadReassignPort}; the
 * admin module's "Wave 2 rebinds this token" placeholder) to
 * `LeadService.bulkReassign` (CORRECTIONS.md §FR-130).
 *
 * Reassigns EVERY open (non-terminal, non-deleted) lead owned by `fromUserId`
 * in LIMIT-bounded batches of {@link BULK_REASSIGN_MAX_IDS}: each batch is one
 * bounded SELECT (the owner module reading its own table) followed by
 * `LeadService.bulkReassign` (version bump + one `audit_logs(reassign)` per
 * lead), all inside the CALLER's ambient transaction — the user deactivation
 * and the reassignment commit or roll back together.
 */
@Injectable()
export class LeadReassignmentAdapter implements LeadReassignPort {
  constructor(private readonly leads: LeadService) {}

  async bulkReassign(
    fromUserId: string,
    toUserId: string,
    reason: string,
    tx: DbTransaction,
  ): Promise<number> {
    let total = 0;
    // Each iteration re-queries: reassigned rows leave the predicate, so the
    // loop terminates once no open lead remains with the old owner.
    for (;;) {
      const batch = await tx
        .selectFrom('leads')
        .select('lead_id')
        .where('owner_id', '=', fromUserId)
        .where('deleted_at', 'is', null)
        .where('stage', 'not in', [...TERMINAL_LEAD_STAGES])
        .orderBy('lead_id')
        .limit(BULK_REASSIGN_MAX_IDS)
        .execute();
      if (batch.length === 0) {
        return total;
      }
      total += await this.leads.bulkReassign(
        batch.map((row) => row.lead_id),
        toUserId,
        reason,
        tx,
      );
    }
  }
}
