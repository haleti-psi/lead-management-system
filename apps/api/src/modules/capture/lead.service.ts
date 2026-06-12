import { Injectable } from '@nestjs/common';

import {
  AuditAction,
  ERROR_CODES,
  EventCode,
  LeadStage,
  type ConsentStatus,
  type CreationChannel,
  type DupStatus,
  type KycStatus,
  type ProductCode,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { BULK_REASSIGN_MAX_IDS, LEADS_RESOURCE_TYPE, TERMINAL_LEAD_STAGES } from './capture.constants';

/** Input for {@link LeadService.create} — every column FR-010 sets at capture. */
export interface CreateLeadInput {
  org_id: string;
  lead_code: string;
  product_code: ProductCode;
  product_config_id: string;
  branch_id: string | null;
  pin_code: string | null;
  owner_id: string | null;
  source_attribution_id: string;
  customer_profile_id: string | null;
  lead_identity_id: string;
  channel_created_by: CreationChannel;
  consent_status: ConsentStatus;
  duplicate_status: DupStatus;
  kyc_status: KycStatus;
  requested_amount: number | null;
  import_job_id: string | null;
  created_by: string;
}

/** Append-only `stage_history` entry (from_stage=null on initial capture). */
export interface StageHistoryEntry {
  org_id: string;
  lead_id: string;
  from_stage: LeadStage | null;
  to_stage: LeadStage;
  actor_id: string;
  reason: string | null;
}

/**
 * FR-010 — `LeadService`, the SOLE writer of `leads` (architecture §11.2; the
 * serialization point for every Lead-writer FR; auth-matrix `leads.writer`). No
 * other module/service may INSERT/UPDATE `leads` — consumers call these mutators
 * with the ambient {@link UnitOfWork} transaction. Single-row mutators take
 * `expectedVersion` and update under `WHERE version = :v` (stale → CONFLICT 409,
 * shared-utilities.md); `bulkReassign` is the LIMIT-bounded admin path with no
 * per-row expectedVersion.
 *
 * The full §11.2 interface is exposed so the contract is frozen now; mutators
 * owned by later FRs throw a typed INTERNAL_ERROR until their FR lands (the
 * Wave-1 "never a silent no-op" convention) — they are listed at the bottom.
 */
@Injectable()
export class LeadService {
  constructor(
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * INSERT the lead at its entry state (`stage='captured'`, `version=1` —
   * state-machines.md §Lead `[NONE] → captured`). FR-010 LLD step E5. The
   * caller (CaptureService) writes stage_history/audit/outbox in the same tx.
   */
  async create(input: CreateLeadInput, tx: DbTransaction): Promise<{ lead_id: string }> {
    const row = await tx
      .insertInto('leads')
      .values({
        org_id: input.org_id,
        lead_code: input.lead_code,
        stage: LeadStage.CAPTURED,
        product_code: input.product_code,
        product_config_id: input.product_config_id,
        branch_id: input.branch_id,
        pin_code: input.pin_code,
        owner_id: input.owner_id,
        source_attribution_id: input.source_attribution_id,
        customer_profile_id: input.customer_profile_id,
        lead_identity_id: input.lead_identity_id,
        channel_created_by: input.channel_created_by,
        consent_status: input.consent_status,
        duplicate_status: input.duplicate_status,
        kyc_status: input.kyc_status,
        priority: 'normal',
        requested_amount: input.requested_amount,
        import_job_id: input.import_job_id,
        version: 1,
        created_by: input.created_by,
        updated_by: input.created_by,
      })
      .returning('lead_id')
      .executeTakeFirstOrThrow();
    return { lead_id: row.lead_id };
  }

  /**
   * Append a `stage_history` row (append-only; M2-owned sink). `from_stage` is
   * null only for the initial capture (FR-010 LLD step E7).
   */
  async appendStageHistory(entry: StageHistoryEntry, tx: DbTransaction): Promise<void> {
    await tx
      .insertInto('stage_history')
      .values({
        org_id: entry.org_id,
        lead_id: entry.lead_id,
        from_stage: entry.from_stage,
        to_stage: entry.to_stage,
        actor_id: entry.actor_id,
        reason: entry.reason,
      })
      .execute();
  }

  /**
   * Set `leads.sla_first_contact_due_at` under optimistic lock, bumping
   * `version` (LeadSlaWriterPort contract — core/sla seam). Stale → CONFLICT.
   */
  async setSlaDueAt(
    leadId: string,
    dueAt: Date,
    expectedVersion: number,
    tx: DbTransaction,
  ): Promise<void> {
    const result = await tx
      .updateTable('leads')
      .set((eb) => ({
        sla_first_contact_due_at: dueAt,
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('lead_id', '=', leadId)
      .where('version', '=', expectedVersion)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new DomainException(ERROR_CODES.CONFLICT);
    }
  }

  /**
   * Assign/reassign the lead's owner (§11.2). Idempotent: when `ownerId` already
   * owns the lead the write is skipped (LeadSlaWriterPort contract). Writes the
   * audit (`allocate` on first assignment, `reassign` on a change) and the
   * `LEAD_ASSIGNED` outbox event in the SAME transaction as the update.
   */
  async assignOwner(
    leadId: string,
    ownerId: string,
    reason: string,
    tx: DbTransaction,
  ): Promise<void> {
    const lead = await tx
      .selectFrom('leads')
      .select(['lead_id', 'org_id', 'lead_code', 'owner_id', 'version'])
      .where('lead_id', '=', leadId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (lead.owner_id === ownerId) {
      return; // already the owner — idempotent skip, no version churn
    }

    const updateResult = await tx
      .updateTable('leads')
      .set((eb) => ({ owner_id: ownerId, version: eb('version', '+', 1), updated_at: new Date(), updated_by: ownerId }))
      .where('lead_id', '=', leadId)
      .where('version', '=', lead.version)
      .executeTakeFirst();
    if (updateResult.numUpdatedRows === 0n) {
      // Concurrent writer bumped the version between our read and write.
      throw new DomainException(ERROR_CODES.CONFLICT);
    }

    await this.audit.append(
      {
        action: lead.owner_id == null ? AuditAction.ALLOCATE : AuditAction.REASSIGN,
        entity_type: LEADS_RESOURCE_TYPE,
        entity_id: leadId,
        actor_id: ownerId,
        org_id: lead.org_id,
        lead_id: leadId,
        detail: { reason, previous_owner_id: lead.owner_id, new_owner_id: ownerId },
      },
      tx,
    );
    await this.outbox.emit(
      {
        event_code: EventCode.LEAD_ASSIGNED,
        aggregate_type: LEADS_RESOURCE_TYPE,
        aggregate_id: leadId,
        payload: { lead_id: leadId, lead_code: lead.lead_code, owner_id: ownerId, reason },
      },
      tx,
    );
  }

  /**
   * Set the explainable score (volatile system field, §11.2) under optimistic
   * lock (shared-utilities.md: single-row mutators take expectedVersion).
   * Consumed by FR-011 scoring via the capture seam.
   */
  async setScore(
    leadId: string,
    score: number,
    reasons: Record<string, unknown> | unknown[],
    expectedVersion: number,
    tx: DbTransaction,
  ): Promise<void> {
    const result = await tx
      .updateTable('leads')
      .set((eb) => ({
        score,
        score_reasons: JSON.stringify(reasons),
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('lead_id', '=', leadId)
      .where('version', '=', expectedVersion)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new DomainException(ERROR_CODES.CONFLICT);
    }
  }

  /**
   * FR-130 admin path (CORRECTIONS.md): reassign up to {@link BULK_REASSIGN_MAX_IDS}
   * leads to `ownerId` in one LIMIT-bounded statement — bumps `version` per row,
   * appends ONE `audit_logs(reassign)` per lead, no per-row expectedVersion.
   * Terminal/deleted leads are skipped. Returns the number actually reassigned.
   */
  async bulkReassign(
    leadIds: readonly string[],
    ownerId: string,
    reason: string,
    tx: DbTransaction,
  ): Promise<number> {
    if (leadIds.length === 0) {
      return 0;
    }
    if (leadIds.length > BULK_REASSIGN_MAX_IDS) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'lead_ids', issue: `At most ${BULK_REASSIGN_MAX_IDS} leads per bulk reassignment.` }],
      });
    }

    const updated = await tx
      .updateTable('leads')
      .set((eb) => ({ owner_id: ownerId, version: eb('version', '+', 1), updated_at: new Date(), updated_by: ownerId }))
      .where('lead_id', 'in', [...leadIds])
      .where('deleted_at', 'is', null)
      .where('stage', 'not in', [...TERMINAL_LEAD_STAGES])
      .returning(['lead_id', 'org_id'])
      .execute();

    for (const lead of updated) {
      await this.audit.append(
        {
          action: AuditAction.REASSIGN,
          entity_type: LEADS_RESOURCE_TYPE,
          entity_id: lead.lead_id,
          actor_id: ownerId,
          org_id: lead.org_id,
          lead_id: lead.lead_id,
          detail: { reason, new_owner_id: ownerId, bulk: true },
        },
        tx,
      );
    }
    return updated.length;
  }

  // ── §11.2 mutators owned by later FRs ─────────────────────────────────────
  // Interface frozen now; implementations land with their owning FR. Each throws
  // a typed INTERNAL_ERROR (never a silent no-op — Wave-1 convention, see
  // UnimplementedLeadReassignAdapter) so a premature call fails loudly and rolls
  // its transaction back.

  /** FR-052 — stage transition (StageGuardService matrix + history/audit/outbox). */
  transitionStage(
    _leadId: string,
    _toStage: LeadStage,
    _guardCtx: Record<string, unknown>,
    _expectedVersion: number,
    _tx: DbTransaction,
  ): Promise<void> {
    return Promise.reject(notYetWired('transitionStage', 'FR-052'));
  }

  /** FR-031 — hot-lead flag (volatile field). */
  setHotFlag(_leadId: string, _isHot: boolean, _reasons: unknown, _tx: DbTransaction): Promise<void> {
    return Promise.reject(notYetWired('setHotFlag', 'FR-031'));
  }

  /** FR-070/072 — derived `kyc_status` summary. */
  setKycStatus(_leadId: string, _status: KycStatus, _tx: DbTransaction): Promise<void> {
    return Promise.reject(notYetWired('setKycStatus', 'FR-070'));
  }

  /** FR-110 — derived `consent_status` summary. */
  setConsentStatus(_leadId: string, _status: ConsentStatus, _tx: DbTransaction): Promise<void> {
    return Promise.reject(notYetWired('setConsentStatus', 'FR-110'));
  }

  /** FR-080 — eligibility snapshot reference. */
  recordEligibility(_leadId: string, _snapshotRef: string, _tx: DbTransaction): Promise<void> {
    return Promise.reject(notYetWired('recordEligibility', 'FR-080'));
  }

  /** FR-081 — LOS hand-off terminal write. */
  markHandedOff(_leadId: string, _losAppId: string, _expectedVersion: number, _tx: DbTransaction): Promise<void> {
    return Promise.reject(notYetWired('markHandedOff', 'FR-081'));
  }

  /** FR-021 — merge duplicate into master. */
  merge(_masterId: string, _duplicateId: string, _reason: string, _tx: DbTransaction): Promise<void> {
    return Promise.reject(notYetWired('merge', 'FR-021'));
  }
}

function notYetWired(method: string, fr: string): DomainException {
  return new DomainException(
    ERROR_CODES.INTERNAL_ERROR,
    `LeadService.${method} is not available yet (lands with ${fr}).`,
  );
}
