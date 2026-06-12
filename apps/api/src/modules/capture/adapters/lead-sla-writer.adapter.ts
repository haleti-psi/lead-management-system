import { Injectable } from '@nestjs/common';

import { AllocationMethod } from '@lms/shared';

import type { DbTransaction } from '../../../core/db';
import type { LeadSlaWriterPort } from '../../../core/sla';
import { SYSTEM_ACTOR_ID } from '../capture.constants';
import { LeadService } from '../lead.service';

/**
 * FR-010 — binds the Wave-1 `core/sla` seam ({@link LeadSlaWriterPort},
 * "WIRE-LATER (capture / FR-010, FR-030)") to the real `LeadService`, the sole
 * writer of `leads` (§11.2). Registered against `LEAD_SLA_WRITER_PORT` by the
 * @Global CaptureModule so the global SlaEngine resolves it everywhere.
 */
@Injectable()
export class LeadSlaWriterAdapter implements LeadSlaWriterPort {
  constructor(private readonly leads: LeadService) {}

  /** `leads.sla_first_contact_due_at` under optimistic lock (stale → CONFLICT). */
  setSlaDueAt(
    args: { leadId: string; dueAt: Date; expectedVersion: number },
    tx: DbTransaction,
  ): Promise<void> {
    return this.leads.setSlaDueAt(args.leadId, args.dueAt, args.expectedVersion, tx);
  }

  /**
   * SLA-breach reassignment. `LeadService.assignOwner` is idempotent (skips when
   * `newOwnerId` already owns the assigned lead — the port contract) and writes
   * the stage_history/audit + LEAD_ASSIGNED outbox atomically in the caller's
   * tx. System-originated (`SYSTEM_ACTOR_ID`), method `escalation`; the team is
   * left unchanged (an SLA escalation moves the owner, not the team).
   */
  async reassignOwner(
    args: { leadId: string; newOwnerId: string; reason: string; expectedVersion: number },
    tx: DbTransaction,
  ): Promise<void> {
    await this.leads.assignOwner(
      args.leadId,
      {
        ownerId: args.newOwnerId,
        reason: args.reason,
        method: AllocationMethod.ESCALATION,
        actorId: SYSTEM_ACTOR_ID,
        expectedVersion: args.expectedVersion,
      },
      tx,
    );
  }
}
