import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { ERROR_CODES } from '@lms/shared';

import type { DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { GRIEVANCE_NO_MAX_SEQ, LEAD_CODE_MAX_SEQ } from './capture.constants';

/** IST offset — lead codes roll their year on the India business calendar. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * FR-010 — `CodeGenerator.nextLeadCode(tx, orgId)` (shared-utilities.md):
 * `LD-{YYYY}-{seq6}`, atomic under concurrency.
 *
 * The data model has no sequence table (and we must not invent one), so
 * atomicity comes from a transaction-scoped Postgres advisory lock keyed on
 * `org + year`: concurrent creators serialize on the lock, read the current
 * MAX(lead_code) for the year prefix, and allocate max+1. The lock releases at
 * commit/rollback; `uq_leads_code (org_id, lead_code)` remains the backstop.
 * Zero-padded fixed-width sequences make MAX() correct lexicographically.
 */
@Injectable()
export class CodeGenerator {
  async nextLeadCode(tx: DbTransaction, orgId: string, now: Date = new Date()): Promise<string> {
    const year = istYear(now);
    const prefix = `LD-${year}-`;

    // Serialize allocation per org+year for the remainder of this transaction.
    await this.acquireYearLock(tx, orgId, year);

    const row = await tx
      .selectFrom('leads')
      .where('org_id', '=', orgId)
      .where('lead_code', 'like', `${prefix}%`)
      .select((eb) => eb.fn.max('lead_code').as('max_code'))
      .limit(1)
      .executeTakeFirst();

    const lastSeq = row?.max_code ? Number.parseInt(row.max_code.slice(prefix.length), 10) : 0;
    const nextSeq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
    if (nextSeq > LEAD_CODE_MAX_SEQ) {
      throw new DomainException(
        ERROR_CODES.INTERNAL_ERROR,
        `Lead code capacity for ${year} exhausted.`,
      );
    }
    return `${prefix}${String(nextSeq).padStart(6, '0')}`;
  }

  /**
   * FR-061 — `GRV-{YYYY}-{seq5}` grievance number, atomic under concurrency via
   * the same per-org+year advisory lock + MAX()+1 allocation as
   * {@link nextLeadCode}. `uq_grievances_no (org_id, grievance_no)` is the backstop.
   */
  async nextGrievanceNo(tx: DbTransaction, orgId: string, now: Date = new Date()): Promise<string> {
    const year = istYear(now);
    const prefix = `GRV-${year}-`;

    await this.acquireGrievanceYearLock(tx, orgId, year);

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
    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  }

  /** Per-org+year advisory lock for grievance-number allocation (see {@link acquireYearLock}). */
  protected async acquireGrievanceYearLock(tx: DbTransaction, orgId: string, year: number): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`grievance_no:${orgId}:${year}`}, 0))`.execute(tx);
  }

  /**
   * `pg_advisory_xact_lock` keyed on org+year — held until commit/rollback so
   * concurrent allocators serialize (U-13). Protected seam: unit tests override
   * it (no Postgres in the unit tier); the SQL itself is parameterised.
   */
  protected async acquireYearLock(tx: DbTransaction, orgId: string, year: number): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`lead_code:${orgId}:${year}`}, 0))`.execute(tx);
  }
}

/** Calendar year in IST (Asia/Kolkata, fixed UTC+5:30 — no DST). */
function istYear(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCFullYear();
}
