import type { DbTransaction } from '../../../core/db';

/**
 * FR-130 owner-writes seam for bulk lead reassignment on user deactivation.
 *
 * `leads` has a single writer — `LeadService` (architecture §11.2 / auth-matrix
 * `leads.writer`). FR-130 must NOT issue SQL against `leads` directly. When a
 * user with open leads is deactivated, the admin service hands the reassignment
 * to this narrow port, which Wave 2 (FR-010/030, M2) binds to
 * `LeadService.bulkReassign` — the LIMIT-bounded mutator that bumps each lead's
 * `version` and appends one `audit_logs(reassign)` row per lead (CORRECTIONS.md
 * §FR-130). The admin service still owns the surrounding {@link UnitOfWork}
 * transaction and passes its `tx` through, so the reassignment, the user status
 * change, and the user-change audit commit (or roll back) atomically together.
 *
 * Until Wave 2 wires the real adapter, {@link LEAD_REASSIGN_PORT} resolves to the
 * placeholder {@link UnimplementedLeadReassignAdapter}, which throws a typed
 * `INTERNAL_ERROR` (it is never a silent no-op). Unit tests inject a mock.
 */
export interface LeadReassignPort {
  /**
   * Reassign every open (non-terminal, non-deleted) lead currently owned by
   * `fromUserId` to `toUserId`, within the caller's ambient transaction.
   * Returns the number of leads reassigned. Owner-writes: the implementation is
   * the only code permitted to write the `leads` table.
   *
   * @param fromUserId the deactivating user (current owner)
   * @param toUserId   the active user to receive the leads
   * @param reason     audit reason recorded against each reassignment
   * @param tx         the ambient {@link UnitOfWork} transaction
   */
  bulkReassign(fromUserId: string, toUserId: string, reason: string, tx: DbTransaction): Promise<number>;
}

/** DI token for the {@link LeadReassignPort} (wired in `admin.module.ts`). */
export const LEAD_REASSIGN_PORT = Symbol('LEAD_REASSIGN_PORT');
