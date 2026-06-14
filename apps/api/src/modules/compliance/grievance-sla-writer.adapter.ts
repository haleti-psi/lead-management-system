import { Injectable } from '@nestjs/common';

import type { DbTransaction } from '../../core/db';
import type { GrievanceSlaWriterPort } from '../../core/sla/sla.ports';
import { GrievanceRepository } from './grievance.repository';

/**
 * FR-114 — Adapter that binds the `GRIEVANCE_SLA_WRITER_PORT` seam declared in
 * `core/sla/sla.ports.ts` (`WIRE-LATER` comment). This wires the SlaEngine's
 * `setGrievanceDue` method to the M12-owned `GrievanceRepository.setSlaAt`,
 * satisfying the owner-writes rule: the SLA engine never touches `grievances`
 * directly; it calls this adapter which delegates to M12's repository.
 */
@Injectable()
export class GrievanceSlaWriterAdapter implements GrievanceSlaWriterPort {
  constructor(private readonly repo: GrievanceRepository) {}

  async setSlaDueAt(
    args: { grievanceId: string; orgId: string; dueAt: Date; actorId: string },
    tx: DbTransaction,
  ): Promise<void> {
    await this.repo.setSlaAt(args.grievanceId, args.orgId, args.dueAt, args.actorId, tx);
  }
}
