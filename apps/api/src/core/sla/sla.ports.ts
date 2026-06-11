import type { DbTransaction } from '../db';
import type { SlaPolicyForCompute } from './sla.types';
import type { SlaTarget } from '@lms/shared';

/**
 * FR-104 — DEPENDENCY SEAMS.
 *
 * The SLA engine must NOT write `leads` / `kyc_verifications` / `grievances`
 * directly: those tables are owned by other modules (owner-writes §11). M2
 * Capture (LeadService / AllocationService) and the KYC/Grievance modules are
 * NOT built yet, so the engine depends only on these NARROW ports and is
 * unit-tested against mocks of them.
 *
 * WIRE-LATER (capture / FR-010, FR-030):
 *   - {@link LeadSlaWriterPort} → adapter delegating to `LeadService.setSlaDueAt`
 *     and `LeadService.assignOwner` (the sole writer of `leads`).
 * WIRE-LATER (KYC / FR-072, Grievance / FR-114):
 *   - {@link KycSlaWriterPort} → `KycService` writes `kyc_verifications.exception_sla_due_at`.
 *   - {@link GrievanceSlaWriterPort} → `GrievanceService` writes `grievances.sla_due_at`.
 *
 * Until those modules exist, no adapter is bound; the SLA engine's write paths
 * (`setFirstContactDue` etc.) accept the port by injection token and are
 * exercised in tests with a fake. The sweep's READ path needs none of these —
 * it only reads `leads` and emits outbox events, both of which are available.
 */

/** DI token for the lead SLA writer adapter (provided by M2 capture later). */
export const LEAD_SLA_WRITER_PORT = Symbol('LEAD_SLA_WRITER_PORT');
/** DI token for the KYC SLA writer adapter (provided by the KYC module later). */
export const KYC_SLA_WRITER_PORT = Symbol('KYC_SLA_WRITER_PORT');
/** DI token for the grievance SLA writer adapter (provided by M12 later). */
export const GRIEVANCE_SLA_WRITER_PORT = Symbol('GRIEVANCE_SLA_WRITER_PORT');
/** DI token for the SLA policy reader (provided by M11 engagement). */
export const SLA_POLICY_READER_PORT = Symbol('SLA_POLICY_READER_PORT');

/**
 * Narrow write surface over `leads` that the SLA engine needs. Backed by
 * `LeadService` (owner-writes). All methods run inside the caller's `tx`.
 */
export interface LeadSlaWriterPort {
  /**
   * Set `leads.sla_first_contact_due_at` via `LeadService.setSlaDueAt`, bumping
   * `version` under optimistic lock. A stale `expectedVersion` → CONFLICT.
   */
  setSlaDueAt(
    args: { leadId: string; dueAt: Date; expectedVersion: number },
    tx: DbTransaction,
  ): Promise<void>;

  /**
   * Reassign a lead's owner on SLA breach via `LeadService.assignOwner`
   * (writes audit + LEAD_ASSIGNED outbox atomically). Idempotent: implementations
   * skip the write when `newOwnerId` already equals the current owner.
   */
  reassignOwner(
    args: { leadId: string; newOwnerId: string; reason: string; expectedVersion: number },
    tx: DbTransaction,
  ): Promise<void>;
}

/** Narrow write surface over `kyc_verifications` (owner: KYC module). */
export interface KycSlaWriterPort {
  setExceptionSlaDueAt(
    args: { kycVerificationId: string; dueAt: Date },
    tx: DbTransaction,
  ): Promise<void>;
}

/** Narrow write surface over `grievances` (owner: M12). */
export interface GrievanceSlaWriterPort {
  setSlaDueAt(
    args: { grievanceId: string; dueAt: Date; actorId: string },
    tx: DbTransaction,
  ): Promise<void>;
}

/**
 * Read surface over `sla_policies` the engine uses to pick the governing policy
 * for an `applies_to` target. Implemented by the engagement repository (M11), so
 * the core engine does not couple to that module's repository class.
 */
export interface SlaPolicyReaderPort {
  /**
   * The most-specific ACTIVE policy for `appliesTo` whose `condition` matches the
   * given attributes (condition-less policy is the fallback). `undefined` when no
   * active policy applies.
   */
  findActivePolicy(
    appliesTo: SlaTarget,
    attributes: Record<string, unknown>,
  ): Promise<SlaPolicyForCompute | undefined>;
}
