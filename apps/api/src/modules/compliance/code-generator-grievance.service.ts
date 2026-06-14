import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { ERROR_CODES } from '@lms/shared';

import type { DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { GRIEVANCE_NO_MAX_SEQ } from './grievance.constants';

/** IST offset — grievance codes roll their year on the India business calendar. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * M12 — `GrievanceCodeGenerator.nextGrievanceNo(orgId, tx)`:
 * generates `GRV-{YYYY}-{seq6}` atomically under concurrency.
 *
 * Same pattern as FR-010's `CodeGenerator` (shared-utilities.md): a
 * transaction-scoped Postgres advisory lock keyed on `org + year` serialises
 * concurrent creators; `uq_grievances_no (org_id, grievance_no)` is the backstop.
 */
@Injectable()
export class GrievanceCodeGenerator {
  async nextGrievanceNo(orgId: string, tx: DbTransaction, now: Date = new Date()): Promise<string> {
    const year = istYear(now);
    const prefix = `GRV-${year}-`;

    await this.acquireYearLock(tx, orgId, year);

    const row = await tx
      .selectFrom('grievances')
      .where('org_id', '=', orgId)
      .where('grievance_no', 'like', `${prefix}%`)
      .select((eb) => eb.fn.max('grievance_no').as('max_no'))
      .limit(1)
      .executeTakeFirst();

    const lastSeq = row?.max_no ? Number.parseInt(row.max_no.slice(prefix.length), 10) : 0;
    const nextSeq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
    if (nextSeq > GRIEVANCE_NO_MAX_SEQ) {
      throw new DomainException(
        ERROR_CODES.INTERNAL_ERROR,
        `Grievance number capacity for ${year} exhausted.`,
      );
    }
    return `${prefix}${String(nextSeq).padStart(6, '0')}`;
  }

  /**
   * `pg_advisory_xact_lock` keyed on org+year — held until commit/rollback.
   * Protected (overrideable in unit tests to avoid requiring Postgres).
   */
  protected async acquireYearLock(tx: DbTransaction, orgId: string, year: number): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`grievance_no:${orgId}:${year}`}, 0))`.execute(tx);
  }
}

/** Calendar year in IST (Asia/Kolkata, fixed UTC+5:30 — no DST). */
function istYear(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCFullYear();
}
