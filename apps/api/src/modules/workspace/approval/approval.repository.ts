import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { DbTransaction } from '../../../core/db';

/** Input for an approval row insert (ApprovalRepository — owns `lead_approvals`). */
export interface InsertApprovalInput {
  lead_id: string;
  /** Stored enum value: 'approved' or 'rejected' (NOT the request verb 'approve'/'reject'). */
  decision: 'approved' | 'rejected';
  reason: string | null;
  decided_by: string;
  org_id: string;
}

/**
 * FR-055 — `ApprovalRepository`: the SOLE writer of `lead_approvals`.
 * Every insert runs inside the caller's `UnitOfWork` transaction — this
 * repository issues no INSERT outside the tx argument.
 */
@Injectable()
export class ApprovalRepository {

  /**
   * INSERT one row into `lead_approvals` within the provided transaction.
   * The DB CHECK constraint (`ck_lead_approvals_reject_reason`) enforces
   * `reason IS NOT NULL` when `decision='rejected'`; we also enforce it at
   * the Zod layer so the caller always passes a reason when rejecting.
   */
  async insert(tx: DbTransaction, input: InsertApprovalInput): Promise<void> {
    const now = new Date();
    await tx
      .insertInto('lead_approvals')
      .values({
        approval_id: randomUUID(),
        org_id: input.org_id,
        lead_id: input.lead_id,
        decision: input.decision,
        reason: input.reason ?? null,
        decided_by: input.decided_by,
        decided_at: now,
        created_at: now,
        updated_at: now,
        created_by: input.decided_by,
        updated_by: input.decided_by,
      })
      .execute();
  }
}
