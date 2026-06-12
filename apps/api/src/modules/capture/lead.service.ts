import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import {
  AuditAction,
  DupAction,
  DupStatus,
  ERROR_CODES,
  EventCode,
  LeadStage,
  type AllocationMethod,
  type ConsentStatus,
  type CreationChannel,
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
 * Input for {@link LeadService.assignOwner} (FR-030 LLD §Data Operations —
 * `assignOwner(leadId, { ownerId, teamId, reason, expectedVersion }, tx)`).
 * `ownerId=null` is the unassigned-pool variant (no-match fallback): only
 * `team_id` changes, the stage is NOT transitioned and nothing is audited
 * (INV-01/INV-02/INV-08) — the `LEAD_ASSIGNED` outbox event still fires.
 */
export interface AssignOwnerInput {
  /** Winning RM, or null for the branch unassigned pool. */
  ownerId: string | null;
  /** `leads.team_id` to set; omit (undefined) to leave the column unchanged. */
  teamId?: string | null;
  /** Auditable reason (mandatory on the manual path; rule label on auto). */
  reason: string;
  /** Allocation method, `'manual'` for POST /leads/{id}/reassign, null on no-match. */
  method: AllocationMethod | 'manual' | null;
  /** Caller (BM/SM/HEAD) or the system actor for automatic allocation. */
  actorId: string;
  /** Optimistic lock — `WHERE version = :v`; stale → CONFLICT (409). */
  expectedVersion: number;
  /**
   * `sla_first_contact_due_at`, computed by the SLA engine. Set ONLY on the
   * `captured → assigned` transition (state-machines.md); never on reassignment
   * (ignored unless the lead is actually entering `assigned`).
   */
  slaFirstContactDueAt?: Date;
  /** `allocate` (Path A) / `reassign` (Path B); defaults by previous owner. */
  auditAction?: typeof AuditAction.ALLOCATE | typeof AuditAction.REASSIGN;
  /** Extra audit detail (e.g. `override_capacity`, `allocation_rule_id`). */
  detail?: Record<string, unknown>;
}

/** Lead state after {@link LeadService.assignOwner} (reassign response shape). */
export interface AssignOwnerResult {
  lead_id: string;
  owner_id: string | null;
  team_id: string | null;
  stage: LeadStage;
  version: number;
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
   * Assign/reassign the lead's owner + team (§11.2 / FR-030). One atomic UPDATE
   * under optimistic lock (`WHERE version = expectedVersion`; stale → CONFLICT)
   * sets `owner_id`, `team_id` and — only from the allow-listed entry stages
   * (`captured`/`dormant` → `assigned`, state-machines.md §Lead) — `stage` +
   * `sla_first_contact_due_at`. At `assigned` or any later stage the owner/team
   * change leaves the stage untouched ("assigned→assigned: owner changes; stage
   * stays") — a reassignment never regresses the lead. Then, in the SAME
   * transaction: `stage_history` (only on that real transition — INV-02),
   * `audit_logs` (`allocate`/`reassign`) and the `LEAD_ASSIGNED` outbox event.
   * Idempotent: when `ownerId` already owns an already-`assigned` lead the
   * write is skipped (LeadSlaWriterPort contract).
   *
   * `ownerId=null` is the FR-030 no-match unassigned-pool variant: the lead
   * keeps its stage (`captured`, INV-01) and owner; only `team_id` is parked on
   * the branch pool team; no stage_history/audit rows (INV-02/INV-08); the
   * `LEAD_ASSIGNED` event (owner_id=null) still fires.
   */
  async assignOwner(
    leadId: string,
    input: AssignOwnerInput,
    tx: DbTransaction,
  ): Promise<AssignOwnerResult> {
    const lead = await tx
      .selectFrom('leads')
      .select(['lead_id', 'org_id', 'lead_code', 'owner_id', 'team_id', 'stage', 'version'])
      .where('lead_id', '=', leadId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (lead.stage === LeadStage.HANDED_OFF) {
      // Terminal in LMS (state-machines.md §Lead) — never reassignable.
      throw new DomainException(ERROR_CODES.CONFLICT, 'Lead is in a terminal stage and cannot be reassigned.');
    }

    if (input.ownerId === null) {
      return this.parkInUnassignedPool(lead, input, tx);
    }

    if (lead.owner_id === input.ownerId && lead.stage === LeadStage.ASSIGNED) {
      // Already the owner of an assigned lead — idempotent skip, no version churn.
      return {
        lead_id: lead.lead_id,
        owner_id: lead.owner_id,
        team_id: lead.team_id,
        stage: lead.stage,
        version: lead.version,
      };
    }

    // `assigned` is only entered from `captured`/`dormant` (state-machines.md
    // §Lead allow-list); reassignment at any other stage moves the owner/team
    // only and must never regress the stage (or reset the first-contact SLA).
    const transitionsToAssigned =
      lead.stage === LeadStage.CAPTURED || lead.stage === LeadStage.DORMANT;

    const updated = await tx
      .updateTable('leads')
      .set((eb) => ({
        owner_id: input.ownerId,
        ...(transitionsToAssigned ? { stage: LeadStage.ASSIGNED } : {}),
        ...(input.teamId !== undefined ? { team_id: input.teamId } : {}),
        ...(transitionsToAssigned && input.slaFirstContactDueAt !== undefined
          ? { sla_first_contact_due_at: input.slaFirstContactDueAt }
          : {}),
        version: eb('version', '+', 1),
        updated_at: new Date(),
        updated_by: input.actorId,
      }))
      .where('lead_id', '=', leadId)
      .where('version', '=', input.expectedVersion)
      .where('deleted_at', 'is', null)
      .returning(['lead_id', 'owner_id', 'team_id', 'stage', 'version'])
      .executeTakeFirst();
    if (!updated) {
      // Concurrent writer bumped the version between the caller's read and this write.
      throw new DomainException(ERROR_CODES.CONFLICT);
    }

    if (transitionsToAssigned) {
      // A real captured/dormant → assigned transition; reassignment at any
      // other stage changes the owner/team only — no history row, since no
      // other entry to `assigned` is in the state-machine allow-list (INV-02).
      await this.appendStageHistory(
        {
          org_id: lead.org_id,
          lead_id: leadId,
          from_stage: lead.stage,
          to_stage: LeadStage.ASSIGNED,
          actor_id: input.actorId,
          reason: input.reason,
        },
        tx,
      );
    }

    await this.audit.append(
      {
        action: input.auditAction ?? (lead.owner_id == null ? AuditAction.ALLOCATE : AuditAction.REASSIGN),
        entity_type: LEADS_RESOURCE_TYPE,
        entity_id: leadId,
        actor_id: input.actorId,
        org_id: lead.org_id,
        lead_id: leadId,
        detail: {
          reason: input.reason,
          method: input.method,
          previous_owner_id: lead.owner_id,
          new_owner_id: input.ownerId,
          team_id: updated.team_id,
          ...input.detail,
        },
      },
      tx,
    );
    await this.outbox.emit(
      {
        event_code: EventCode.LEAD_ASSIGNED,
        aggregate_type: LEADS_RESOURCE_TYPE,
        aggregate_id: leadId,
        payload: {
          lead_id: leadId,
          lead_code: lead.lead_code,
          owner_id: input.ownerId,
          team_id: updated.team_id,
          reason: input.reason,
        },
      },
      tx,
    );

    return updated;
  }

  /**
   * FR-030 no-match fallback (LLD step 7): park the lead on the branch pool
   * team. Stage/owner/SLA untouched (INV-01/INV-05 scope), no audit or
   * stage_history (INV-02/INV-08); only the `LEAD_ASSIGNED` (owner_id=null)
   * outbox event records the routing decision.
   */
  private async parkInUnassignedPool(
    lead: { lead_id: string; org_id: string; lead_code: string; owner_id: string | null; team_id: string | null; stage: LeadStage; version: number },
    input: AssignOwnerInput,
    tx: DbTransaction,
  ): Promise<AssignOwnerResult> {
    let teamId = lead.team_id;
    let version = lead.version;
    if (input.teamId !== undefined && input.teamId !== lead.team_id) {
      const updated = await tx
        .updateTable('leads')
        .set((eb) => ({
          team_id: input.teamId,
          version: eb('version', '+', 1),
          updated_at: new Date(),
          updated_by: input.actorId,
        }))
        .where('lead_id', '=', lead.lead_id)
        .where('version', '=', input.expectedVersion)
        .where('deleted_at', 'is', null)
        .returning(['team_id', 'version'])
        .executeTakeFirst();
      if (!updated) {
        throw new DomainException(ERROR_CODES.CONFLICT);
      }
      teamId = updated.team_id;
      version = updated.version;
    }

    await this.outbox.emit(
      {
        event_code: EventCode.LEAD_ASSIGNED,
        aggregate_type: LEADS_RESOURCE_TYPE,
        aggregate_id: lead.lead_id,
        payload: {
          lead_id: lead.lead_id,
          lead_code: lead.lead_code,
          owner_id: lead.owner_id,
          team_id: teamId,
          reason: input.reason,
        },
      },
      tx,
    );

    return {
      lead_id: lead.lead_id,
      owner_id: lead.owner_id,
      team_id: teamId,
      stage: lead.stage,
      version,
    };
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
   * FR-020 — recompute the derived `leads.duplicate_status` from the
   * highest-severity OPEN `duplicate_matches` row (state-machines.md: derived
   * summary fields are "recomputed on the relevant child change, never set
   * directly"). Called by `DuplicateService` in the SAME transaction as every
   * `duplicate_matches` change. Reads M3's table (read-only — owner-WRITES is
   * the rule, per the FR-020 LLD §Step 4 pseudocode); the `leads` UPDATE runs
   * under optimistic lock (stale `expectedVersion` → CONFLICT, T21) WITHOUT a
   * version bump — a derived/volatile system field must not raise false 409s
   * against concurrent human edits (§11.2). Returns the status written.
   */
  async recomputeDuplicateStatus(
    leadId: string,
    orgId: string,
    actorId: string,
    expectedVersion: number,
    tx: DbTransaction,
  ): Promise<DupStatus> {
    const top = await tx
      .selectFrom('duplicate_matches')
      .select(['action'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('status', '=', 'open')
      .orderBy(
        sql`CASE action
              WHEN 'merged'     THEN 1
              WHEN 'linked'     THEN 2
              WHEN 'blocked'    THEN 3
              WHEN 'queued'     THEN 4
              WHEN 'warned'     THEN 5
              WHEN 'overridden' THEN 6
            END`,
      )
      .limit(1)
      .executeTakeFirst();

    const status: DupStatus =
      top === undefined
        ? DupStatus.NONE
        : top.action === DupAction.MERGED
          ? DupStatus.MERGED
          : top.action === DupAction.LINKED
            ? DupStatus.LINKED
            : top.action === DupAction.OVERRIDDEN
              ? DupStatus.NONE // an override clears the flag (UI-T02)
              : DupStatus.FLAGGED; // blocked | queued | warned

    const result = await tx
      .updateTable('leads')
      .set({ duplicate_status: status, updated_by: actorId, updated_at: new Date() })
      .where('lead_id', '=', leadId)
      .where('version', '=', expectedVersion)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new DomainException(ERROR_CODES.CONFLICT);
    }
    return status;
  }

  /**
   * FR-110 — derived `consent_status` summary (state-machines.md §Lead:
   * "recomputed on the relevant child change, never set directly"). One
   * org-scoped UPDATE setting `consent_status` + `updated_at` only — NO
   * version bump and no `expectedVersion`: this is a volatile system-managed
   * field (FR-110 LLD §Data Operations; architecture §11.2 lists the mutator
   * without `expectedVersion`), so a ledger-driven re-derivation never raises
   * a false 409 against a concurrent RM edit. The stage is untouched. The
   * calling ConsentService owns the derivation and emits audit + outbox in
   * the SAME tx. Zero rows (lead absent/soft-deleted) → NOT_FOUND, never a
   * silent no-op.
   */
  async setConsentStatus(
    leadId: string,
    status: ConsentStatus,
    orgId: string,
    tx: DbTransaction,
  ): Promise<void> {
    const result = await tx
      .updateTable('leads')
      .set({ consent_status: status, updated_at: new Date() })
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
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
