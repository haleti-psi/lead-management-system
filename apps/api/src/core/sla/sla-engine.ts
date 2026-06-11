import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { EventCode, SlaTarget } from '@lms/shared';

import type { DbTransaction } from '../db';
import { OutboxService } from '../outbox';
import { ORG_ID_DEFAULT } from '../outbox/outbox.constants';
import { BusinessCalendarService } from './business-calendar.service';
import { addBusinessMinutes, type BusinessTimeCalendar } from './business-time';
import {
  APPROACHING_WINDOW_MINUTES,
  SWEEP_BATCH_LIMIT,
  SWEEP_EXCLUDED_STAGES,
} from './sla.constants';
import {
  GRIEVANCE_SLA_WRITER_PORT,
  KYC_SLA_WRITER_PORT,
  LEAD_SLA_WRITER_PORT,
  SLA_POLICY_READER_PORT,
  type GrievanceSlaWriterPort,
  type KycSlaWriterPort,
  type LeadSlaWriterPort,
  type SlaPolicyReaderPort,
} from './sla.ports';
import type { CalendarContext, EscalationStep } from './sla.types';

/** A lead row the sweep operates on (the projection both scans select). */
interface SweepLeadRow {
  lead_id: string;
  owner_id: string | null;
  branch_id: string | null;
  sla_first_contact_due_at: Date | null;
  version: number;
}

/** Outcome of a sweep pass (also returned for observability/idempotency assertions). */
export interface SweepResult {
  approachingEmitted: number;
  breachEmitted: number;
  reassigned: number;
}

/**
 * FR-104 — the system-side SLA clock. Two responsibilities:
 *
 *  1. **Due-at computation & setting** (`computeDueAt` + the `set*Due` methods):
 *     resolves the governing business calendar (ADR-6) and the active policy,
 *     then writes the due timestamp THROUGH the owning service's port (never
 *     touching `leads`/`kyc_verifications`/`grievances` directly — owner-writes
 *     §11). The writer ports are not yet bound (M2/KYC/M12 unbuilt); see
 *     {@link sla.ports.ts}. These run inside the caller's UnitOfWork `tx`.
 *
 *  2. **Sweep** (`sweep`): the read-side scan for approaching/breached leads,
 *     emitting `FIRST_CONTACT_DUE` / `FIRST_CONTACT_BREACH` via the transactional
 *     outbox, and triggering breach reassignment via the lead port. The scan
 *     reads `leads` directly (a read is allowed; owner-writes governs WRITES) and
 *     is idempotent within a sweep window.
 */
@Injectable()
export class SlaEngine {
  constructor(
    private readonly calendars: BusinessCalendarService,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(SlaEngine.name) private readonly logger: PinoLogger,
    // Ports are optional at the DI layer: M2/KYC/M12 bind their adapters later.
    // Methods that need an unbound port fail loudly (never silently no-op a write).
    @Optional() @Inject(SLA_POLICY_READER_PORT) private readonly policies?: SlaPolicyReaderPort,
    @Optional() @Inject(LEAD_SLA_WRITER_PORT) private readonly leadWriter?: LeadSlaWriterPort,
    @Optional() @Inject(KYC_SLA_WRITER_PORT) private readonly kycWriter?: KycSlaWriterPort,
    @Optional()
    @Inject(GRIEVANCE_SLA_WRITER_PORT)
    private readonly grievanceWriter?: GrievanceSlaWriterPort,
  ) {}

  /**
   * Compute a business-time-aware due instant for `appliesTo` from `now`.
   * Resolves the calendar for the context branch/region and adds the policy's
   * `threshold_minutes` business minutes. Returns `null` when no active policy
   * applies (the caller then sets no due timestamp and logs — LLD step 2a).
   *
   * `now` is injectable for deterministic tests; production passes `new Date()`.
   */
  async computeDueAt(
    appliesTo: SlaTarget,
    ctx: CalendarContext,
    attributes: Record<string, unknown> = {},
    now: Date = new Date(),
  ): Promise<{ dueAt: Date; policyId: string } | null> {
    const policy = await this.requirePolicyReader().findActivePolicy(appliesTo, attributes);
    if (!policy) {
      this.logger.warn({ appliesTo, attributes }, 'No active SLA policy matched; skipping due-at');
      return null;
    }
    const calendar = await this.calendars.resolve(ctx.branchId, ctx.regionId);
    const dueAt = addBusinessMinutes(now, policy.threshold_minutes, toBusinessCalendar(calendar));
    return { dueAt, policyId: policy.sla_policy_id };
  }

  /**
   * Set `leads.sla_first_contact_due_at` on `captured → assigned`. Called by
   * AllocationService/LeadService (M2) inside the lead's transaction. WIRE-LATER:
   * the {@link LeadSlaWriterPort} adapter delegates to `LeadService.setSlaDueAt`.
   */
  async setFirstContactDue(
    lead: { lead_id: string; branch_id?: string | null; region_id?: string | null; version: number },
    tx: DbTransaction,
    attributes: Record<string, unknown> = {},
    now: Date = new Date(),
  ): Promise<void> {
    const computed = await this.computeDueAt(
      SlaTarget.FIRST_CONTACT,
      { branchId: lead.branch_id, regionId: lead.region_id },
      attributes,
      now,
    );
    if (!computed) return; // no policy → no timestamp (logged in computeDueAt)
    await this.requireLeadWriter().setSlaDueAt(
      { leadId: lead.lead_id, dueAt: computed.dueAt, expectedVersion: lead.version },
      tx,
    );
  }

  /**
   * Set `kyc_verifications.exception_sla_due_at` on `failed → exception`. Called
   * by the KYC module inside its transaction. WIRE-LATER: {@link KycSlaWriterPort}.
   */
  async setKycExceptionDue(
    kyc: { kyc_verification_id: string; branch_id?: string | null; region_id?: string | null },
    tx: DbTransaction,
    attributes: Record<string, unknown> = {},
    now: Date = new Date(),
  ): Promise<void> {
    const computed = await this.computeDueAt(
      SlaTarget.KYC_EXCEPTION,
      { branchId: kyc.branch_id, regionId: kyc.region_id },
      attributes,
      now,
    );
    if (!computed) return;
    await this.requireKycWriter().setExceptionSlaDueAt(
      { kycVerificationId: kyc.kyc_verification_id, dueAt: computed.dueAt },
      tx,
    );
  }

  /**
   * Set `grievances.sla_due_at` on intake. Called by M12 inside its transaction.
   * WIRE-LATER: {@link GrievanceSlaWriterPort}.
   */
  async setGrievanceDue(
    grievance: {
      grievance_id: string;
      branch_id?: string | null;
      region_id?: string | null;
      actor_id: string;
    },
    tx: DbTransaction,
    attributes: Record<string, unknown> = {},
    now: Date = new Date(),
  ): Promise<void> {
    const computed = await this.computeDueAt(
      SlaTarget.GRIEVANCE,
      { branchId: grievance.branch_id, regionId: grievance.region_id },
      attributes,
      now,
    );
    if (!computed) return;
    await this.requireGrievanceWriter().setSlaDueAt(
      { grievanceId: grievance.grievance_id, dueAt: computed.dueAt, actorId: grievance.actor_id },
      tx,
    );
  }

  /**
   * One sweep pass over first-contact SLAs, inside the caller's UnitOfWork `tx`.
   *
   *  - **Approaching**: leads due within {@link APPROACHING_WINDOW_MINUTES} and not
   *    yet breached → emit `FIRST_CONTACT_DUE` (once per lead per window).
   *  - **Breached**: leads at/over due → emit `FIRST_CONTACT_BREACH`, and for any
   *    escalation step with `action:'reassign'` trigger reassignment via the lead
   *    port (idempotent: the adapter skips when the owner already matches).
   *
   * Terminal/contacted stages are excluded. Both scans are `LIMIT`-bounded.
   * Idempotency: an event is emitted only when no matching outbox row already
   * exists for the lead within the current window — a second run in the same tick
   * is a no-op for already-notified leads.
   */
  async sweep(tx: DbTransaction, now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = { approachingEmitted: 0, breachEmitted: 0, reassigned: 0 };
    const windowEnd = new Date(now.getTime() + APPROACHING_WINDOW_MINUTES * 60_000);

    // ── Breached scan (sla_first_contact_due_at <= now) ──────────
    const breached = await this.scanBase(tx).where('sla_first_contact_due_at', '<=', now).execute();
    for (const lead of breached) {
      const emitted = await this.emitOnce(
        tx,
        EventCode.FIRST_CONTACT_BREACH,
        lead.lead_id,
        now,
        () => ({ lead_id: lead.lead_id, owner_id: lead.owner_id, breached_at: now.toISOString() }),
      );
      if (emitted) result.breachEmitted += 1;
      if (await this.reassignOnBreach(lead, tx)) result.reassigned += 1;
    }

    // ── Approaching scan (now < due <= now + window) ─────────────
    const approaching = await this.scanBase(tx)
      .where('sla_first_contact_due_at', '>', now)
      .where('sla_first_contact_due_at', '<=', windowEnd)
      .execute();
    for (const lead of approaching) {
      const emitted = await this.emitOnce(
        tx,
        EventCode.FIRST_CONTACT_DUE,
        lead.lead_id,
        now,
        () => ({
          lead_id: lead.lead_id,
          owner_id: lead.owner_id,
          due_at: toIso(lead.sla_first_contact_due_at),
        }),
      );
      if (emitted) result.approachingEmitted += 1;
    }

    return result;
  }

  /**
   * Shared, bounded, org-scoped, fully-typed base scan over `leads`: non-null due,
   * not in an excluded (terminal/contacted) stage, ordered by due-at, `LIMIT`ed.
   * The caller appends the window predicate before `.execute()`. Reading `leads`
   * here is permitted — owner-writes governs WRITES only.
   */
  private scanBase(tx: DbTransaction) {
    return tx
      .selectFrom('leads')
      .select(['lead_id', 'owner_id', 'branch_id', 'sla_first_contact_due_at', 'version'])
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('sla_first_contact_due_at', 'is not', null)
      .where('stage', 'not in', SWEEP_EXCLUDED_STAGES)
      .orderBy('sla_first_contact_due_at', 'asc')
      .limit(SWEEP_BATCH_LIMIT);
  }

  /**
   * Emit an outbox event for a lead only if one of the same code does not already
   * exist for it within the current sweep window (idempotency — LLD step 7). The
   * window floor is `now − APPROACHING_WINDOW_MINUTES` so re-runs inside one tick
   * dedupe while a genuinely new window (next due cycle) can re-notify.
   */
  private async emitOnce(
    tx: DbTransaction,
    eventCode: EventCode,
    leadId: string,
    now: Date,
    payload: () => Record<string, unknown>,
  ): Promise<boolean> {
    const windowFloor = new Date(now.getTime() - APPROACHING_WINDOW_MINUTES * 60_000);
    const existing = await tx
      .selectFrom('event_outbox')
      .select('event_id')
      .where('aggregate_type', '=', 'lead')
      .where('aggregate_id', '=', leadId)
      .where('event_code', '=', eventCode)
      .where('created_at', '>=', windowFloor)
      .limit(1)
      .executeTakeFirst();
    if (existing) return false;

    await this.outbox.emit(
      { event_code: eventCode, aggregate_type: 'lead', aggregate_id: leadId, payload: payload() },
      tx,
    );
    return true;
  }

  /**
   * Trigger reassignment for a breached lead when the policy chain says so.
   * The policy reader resolves the chain for the (first-contact) target; any step
   * with `action:'reassign'` drives a reassignment THROUGH the lead port. Target
   * user resolution (role → user) is the capture/allocation adapter's concern;
   * the engine only signals intent. Returns true when a reassignment was issued.
   *
   * WIRE-LATER: with no lead writer bound yet, this logs and returns false rather
   * than throwing — the sweep's primary job (emit the breach event) still
   * completes. Once M2 binds the port, reassignment activates with no engine change.
   */
  private async reassignOnBreach(lead: SweepLeadRow, tx: DbTransaction): Promise<boolean> {
    if (!this.policies || !this.leadWriter) {
      this.logger.warn(
        { lead_id: lead.lead_id },
        'SLA breach reassignment skipped: lead writer / policy reader port not yet bound (M2 capture)',
      );
      return false;
    }
    const policy = await this.policies.findActivePolicy(SlaTarget.FIRST_CONTACT, {
      branch_id: lead.branch_id,
    });
    if (!policy) return false;

    const reassignStep = policy.escalation_chain.find((s) => s.action === 'reassign');
    if (!reassignStep) return false;

    const targetOwnerId = this.resolveReassignTarget(reassignStep);
    if (!targetOwnerId || targetOwnerId === lead.owner_id) return false; // idempotent skip

    await this.leadWriter.reassignOwner(
      {
        leadId: lead.lead_id,
        newOwnerId: targetOwnerId,
        reason: 'sla_breach',
        expectedVersion: lead.version,
      },
      tx,
    );
    return true;
  }

  /**
   * Resolve the user a `reassign` step targets. Mapping a `notify_roles` entry to
   * a concrete user (e.g. the branch BM/SM) requires AllocationService (FR-030),
   * which is not built; the adapter will supply this. Returns null here so the
   * core engine performs no reassignment until the port is wired.
   */
  private resolveReassignTarget(_step: EscalationStep): string | null {
    return null;
  }

  private requirePolicyReader(): SlaPolicyReaderPort {
    if (!this.policies) {
      throw new Error('SLA_POLICY_READER_PORT is not bound (engagement module must provide it).');
    }
    return this.policies;
  }

  private requireLeadWriter(): LeadSlaWriterPort {
    if (!this.leadWriter) {
      throw new Error('LEAD_SLA_WRITER_PORT is not bound (M2 capture must provide it).');
    }
    return this.leadWriter;
  }

  private requireKycWriter(): KycSlaWriterPort {
    if (!this.kycWriter) {
      throw new Error('KYC_SLA_WRITER_PORT is not bound (KYC module must provide it).');
    }
    return this.kycWriter;
  }

  private requireGrievanceWriter(): GrievanceSlaWriterPort {
    if (!this.grievanceWriter) {
      throw new Error('GRIEVANCE_SLA_WRITER_PORT is not bound (M12 must provide it).');
    }
    return this.grievanceWriter;
  }
}

function toBusinessCalendar(c: {
  timezone: string;
  workingHours: BusinessTimeCalendar['workingHours'];
  holidays: BusinessTimeCalendar['holidays'];
}): BusinessTimeCalendar {
  return { timezone: c.timezone, workingHours: c.workingHours, holidays: c.holidays };
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
