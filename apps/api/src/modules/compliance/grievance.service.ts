import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  ERROR_CODES,
  EventCode,
  GrievanceStatus,
  SlaTarget,
  type GrievanceCategory,
  type GrievanceSource,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { SlaEngine } from '../../core/sla';
import { GrievanceCodeGenerator } from './code-generator-grievance.service';
import { GRIEVANCES_RESOURCE_TYPE, SYSTEM_ACTOR_ID_GRIEVANCE } from './grievance.constants';
import { GrievanceRepository, type GrievanceRow } from './grievance.repository';
import type { CreateGrievanceDto } from './dto/create-grievance.dto';
import type { UpdateGrievanceDto } from './dto/update-grievance.dto';
import type { ListGrievancesQuery } from './dto/list-grievances.dto';

/** Caller context for both staff POST (internal) and future customer POST (FR-061). */
export interface GrievanceActorContext {
  /** The user ID making the request (staff) or the customer-link actor ID. */
  callerId: string;
  /** Organisation ID — all writes/reads are scoped to this. */
  orgId: string;
  /** The ABAC-resolved scope predicate (undefined on the customer link path). */
  predicate: ScopePredicate | undefined;
  /** Caller's branch_id if available (used for SLA calendar resolution). */
  branchId?: string | null;
}

/** Full grievance resource shape returned by all endpoints. */
export interface GrievanceData {
  grievanceId: string;
  grievanceNo: string;
  leadId: string | null;
  source: GrievanceSource;
  category: GrievanceCategory;
  description: string;
  ownerId: string | null;
  slaDueAt: Date | null;
  status: GrievanceStatus;
  response: string | null;
  closureProofRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface GrievanceListResult {
  data: GrievanceData[];
  pagination: { page: number; limit: number; total: number };
}

/**
 * FR-114 — Grievance Workflow service (M12 Compliance). Sole writer of `grievances`.
 *
 * The `create` method is deliberately decoupled from the staff HTTP context so that
 * FR-061 (`POST /c/{token}/grievance` — customer intake via self-service) can call
 * it directly without requiring a JWT/staff context. The caller (staff endpoint or
 * FR-061 handler) passes an explicit {@link GrievanceActorContext}; no HTTP request
 * objects enter this service.
 *
 * **FR-061 reuse seam:** `GrievanceService.create(dto, ctx)` accepts `source` and
 * `callerId` as parameters in `ctx` / `dto`. For the customer path, FR-061's
 * handler sets `dto.source = 'customer_link'` and `ctx.callerId = SYSTEM_ACTOR_ID`
 * (or a derived customer actor), derives `dto.leadId` from the validated token, and
 * calls this method — no modification to this service is required.
 */
@Injectable()
export class GrievanceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: GrievanceRepository,
    private readonly codeGen: GrievanceCodeGenerator,
    private readonly sla: SlaEngine,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(GrievanceService.name) private readonly logger: PinoLogger,
  ) {}

  // ─────────────────────────────────────────────────────── List ──

  async list(query: ListGrievancesQuery, ctx: GrievanceActorContext): Promise<GrievanceListResult> {
    const { rows, total } = await this.repo.list({
      orgId: ctx.orgId,
      predicate: ctx.predicate,
      callerId: ctx.callerId,
      query,
    });
    return {
      data: rows.map(toGrievanceData),
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  // ─────────────────────────────────────────────────────── Create ──

  /**
   * Create a new grievance. Usable by both the staff endpoint and FR-061
   * (customer intake) — the caller sets `source` and `callerId` in the context.
   *
   * @param dto     Validated CreateGrievanceDto (source/category/description/optional leadId+ownerId)
   * @param ctx     Caller context (callerId, orgId, predicate, optional branchId)
   * @returns       Full GrievanceData for the response
   */
  async create(dto: CreateGrievanceDto, ctx: GrievanceActorContext): Promise<GrievanceData> {
    const { callerId, orgId } = ctx;

    // Validate leadId referential integrity
    let leadBranchId: string | null = null;
    if (dto.leadId != null) {
      const lead = await this.repo.findLeadInOrg(dto.leadId, orgId);
      if (!lead) {
        throw new DomainException('NOT_FOUND', undefined);
      }
      leadBranchId = lead.branch_id;
    }

    // Validate ownerId referential integrity
    if (dto.ownerId != null) {
      const owner = await this.repo.findActiveUserInOrg(dto.ownerId, orgId);
      if (!owner) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'ownerId', issue: 'Owner not found.' }],
        });
      }
    }

    const grievanceId = randomUUID();
    const branchId = ctx.branchId ?? leadBranchId;

    return this.uow.run(async (tx) => {
      // Generate grievance_no atomically (advisory lock in same tx)
      const grievanceNo = await this.codeGen.nextGrievanceNo(orgId, tx);

      // Compute SLA due timestamp (may return null if no active policy)
      let slaDueAt: Date | null = null;
      try {
        const result = await this.sla.computeDueAt(
          SlaTarget.GRIEVANCE,
          { branchId, regionId: undefined },
        );
        slaDueAt = result?.dueAt ?? null;
      } catch (err) {
        this.logger.warn(
          { err, grievanceId },
          'SLA computation failed for grievance; sla_due_at set to null',
        );
      }

      // 1. Insert grievance row
      const row = await this.repo.insert(
        {
          grievance_id: grievanceId,
          org_id: orgId,
          grievance_no: grievanceNo,
          lead_id: dto.leadId,
          source: dto.source,
          category: dto.category,
          description: dto.description,
          owner_id: dto.ownerId,
          sla_due_at: slaDueAt,
          status: GrievanceStatus.OPEN,
          response: null,
          closure_proof_ref: null,
          created_by: callerId,
          updated_by: callerId,
        },
        tx,
      );

      // 2. Audit (CORRECTIONS.md: action=lead_update, entity_type='grievance')
      await this.audit.append(
        {
          action: AuditAction.LEAD_UPDATE,
          entity_type: GRIEVANCES_RESOURCE_TYPE,
          entity_id: grievanceId,
          actor_id: callerId,
          org_id: orgId,
          lead_id: dto.leadId ?? null,
          detail: {
            event: 'GRIEVANCE_CREATED',
            category: dto.category,
            source: dto.source,
          },
        },
        tx,
      );

      // 3. Outbox event (same tx — atomicity)
      await this.outbox.emit(
        {
          event_code: EventCode.GRIEVANCE_CREATED,
          aggregate_type: 'grievance',
          aggregate_id: grievanceId,
          payload: {
            grievanceNo,
            category: dto.category,
            source: dto.source,
            ownerId: dto.ownerId ?? null,
            slaDueAt: slaDueAt?.toISOString() ?? null,
          },
        },
        tx,
      );

      return toGrievanceData(row);
    });
  }

  // ─────────────────────────────────────────────────────── Update ──

  async update(
    grievanceId: string,
    dto: UpdateGrievanceDto,
    ctx: GrievanceActorContext,
  ): Promise<GrievanceData> {
    const { callerId, orgId } = ctx;

    // Fetch current row (throws NOT_FOUND if absent/out-of-org)
    const current = await this.repo.findByIdOrThrow(grievanceId, orgId);

    // Ownership check for PATCH (LLD §Auth Check — PATCH ownership/scope)
    // AbacGuard handles the broad capability check; here we enforce the additional
    // "must be the owner OR scope A" rule from the LLD.
    this.assertPatchOwnership(current, ctx);

    // State machine validation (throws CONFLICT / VALIDATION_ERROR as appropriate)
    if (dto.status !== undefined) {
      this.validateTransition(current.status, dto.status, dto, current.owner_id);
    }

    // Validate ownerId if being changed
    if (dto.ownerId !== undefined) {
      const owner = await this.repo.findActiveUserInOrg(dto.ownerId, orgId);
      if (!owner) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'ownerId', issue: 'Owner not found.' }],
        });
      }
    }

    const now = new Date();

    return this.uow.run(async (tx) => {
      // 1. Update grievance row
      const updated = await this.repo.update(
        grievanceId,
        orgId,
        {
          status: dto.status,
          response: dto.response !== undefined ? dto.response : current.response,
          closure_proof_ref:
            dto.closureProofRef !== undefined ? dto.closureProofRef : current.closure_proof_ref,
          owner_id: dto.ownerId !== undefined ? dto.ownerId : current.owner_id,
          updated_by: callerId,
          updated_at: now,
        },
        tx,
      );

      // 2. Audit (status transition detail)
      await this.audit.append(
        {
          action: AuditAction.LEAD_UPDATE,
          entity_type: GRIEVANCES_RESOURCE_TYPE,
          entity_id: grievanceId,
          actor_id: callerId,
          org_id: orgId,
          lead_id: current.lead_id,
          detail: {
            transition:
              dto.status !== undefined
                ? { from: current.status, to: dto.status }
                : null,
          },
        },
        tx,
      );

      return toGrievanceData(updated);
    });
  }

  // ─────────────────────────────────────────────── State machine ──

  /**
   * Validate a requested status transition from `current` to `target`.
   * Throws {@link DomainException} with CONFLICT or VALIDATION_ERROR when invalid.
   *
   * Exposed as a public method so it is independently unit-testable (T27/T28/T29/T30).
   */
  validateTransition(
    current: GrievanceStatus,
    target: GrievanceStatus,
    dto: { response?: string; closureProofRef?: string; ownerId?: string | null } = {},
    existingOwnerId?: string | null,
  ): void {
    if (current === target) return; // no-op transitions are silently accepted

    const allowed = ALLOWED_TRANSITIONS[current];
    if (!allowed || !allowed.includes(target)) {
      throw new DomainException(ERROR_CODES.CONFLICT, `Invalid status transition from '${current}' to '${target}'.`);
    }

    // Guard: open → in_progress requires owner_id to be set either in the dto or already on the row
    if (target === GrievanceStatus.IN_PROGRESS) {
      const effectiveOwner = dto.ownerId ?? existingOwnerId;
      if (!effectiveOwner) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'ownerId', issue: 'ownerId must be set before moving to in_progress' }],
        });
      }
    }

    // Guard: resolved requires response
    if (target === GrievanceStatus.RESOLVED && !dto.response?.trim()) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'response', issue: 'Response is required to resolve a grievance.' }],
      });
    }

    // Guard: closed requires closure_proof_ref
    if (target === GrievanceStatus.CLOSED && !dto.closureProofRef?.trim()) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [
          {
            field: 'closureProofRef',
            issue: 'Closure proof reference is required to close a grievance.',
          },
        ],
      });
    }
  }

  // ─────────────────────────────────────────────────── Escalation sweep ──

  /**
   * Escalation sweep: promote breached open/in_progress grievances to `escalated`.
   * Designed to be called by {@link GrievanceEscalationJob} (Cloud Tasks).
   * Each promotion is a separate UnitOfWork transaction (failure of one does not
   * roll back others). Notification dispatch is post-commit (retryable).
   */
  async runEscalationSweep(orgId: string, now: Date = new Date()): Promise<number> {
    const breached = await this.uow.run((tx) =>
      this.repo.findBreachedForEscalation(orgId, now, tx),
    );

    let escalatedCount = 0;

    for (const grievance of breached) {
      try {
        await this.uow.run(async (tx) => {
          await this.repo.update(
            grievance.grievance_id,
            orgId,
            {
              status: GrievanceStatus.ESCALATED,
              updated_by: SYSTEM_ACTOR_ID_GRIEVANCE,
              updated_at: new Date(),
            },
            tx,
          );

          await this.audit.append(
            {
              action: AuditAction.LEAD_UPDATE,
              entity_type: GRIEVANCES_RESOURCE_TYPE,
              entity_id: grievance.grievance_id,
              actor_id: SYSTEM_ACTOR_ID_GRIEVANCE,
              org_id: orgId,
              lead_id: grievance.lead_id,
              detail: {
                transition: { from: grievance.status, to: GrievanceStatus.ESCALATED },
                reason: 'sla_breach',
              },
            },
            tx,
          );
        });

        escalatedCount++;
      } catch (err) {
        // Log but continue — one failure should not abort the rest of the sweep
        this.logger.error(
          { err, grievance_id: grievance.grievance_id, org_id: orgId },
          'Escalation sweep: failed to escalate grievance',
        );
      }
    }

    this.logger.info(
      { module: 'compliance', job: 'grievance-escalation', escalatedCount, orgId },
      'Grievance escalation sweep complete',
    );

    return escalatedCount;
  }

  // ─────────────────────────────────────────────────────── Helpers ──

  /**
   * Assert the caller may PATCH this grievance.
   * LLD: caller must be the `grievances.owner_id` OR hold scope `A` (DPO/HEAD).
   * This runs AFTER AbacGuard has already verified the `consent_ledger` capability.
   */
  private assertPatchOwnership(current: GrievanceRow, ctx: GrievanceActorContext): void {
    const { callerId, predicate } = ctx;

    // scope A (all) — DPO/HEAD may patch any
    if (predicate?.type === 'all' || predicate?.type === 'masked') return;

    // owner check — the caller is the assigned owner
    if (current.owner_id === callerId) return;

    // branch scope — BM may act on branch-scoped grievances
    if (predicate?.type === 'branch') return;

    throw new DomainException(ERROR_CODES.FORBIDDEN);
  }
}

// ─────────────────────────────────── State machine transition table ──

/**
 * Valid next statuses for each current status (LLD §State Machine / state-machines.md §Grievance).
 * `closed` has no valid transitions (an attempt throws CONFLICT).
 */
const ALLOWED_TRANSITIONS: Partial<Record<GrievanceStatus, GrievanceStatus[]>> = {
  [GrievanceStatus.OPEN]: [GrievanceStatus.IN_PROGRESS],
  [GrievanceStatus.IN_PROGRESS]: [GrievanceStatus.ESCALATED, GrievanceStatus.RESOLVED],
  [GrievanceStatus.ESCALATED]: [GrievanceStatus.RESOLVED],
  [GrievanceStatus.RESOLVED]: [GrievanceStatus.CLOSED],
  [GrievanceStatus.CLOSED]: [], // any transition → CONFLICT
};

// ─────────────────────────────────────────────── Serialisation ──

function toGrievanceData(row: GrievanceRow): GrievanceData {
  return {
    grievanceId: row.grievance_id,
    grievanceNo: row.grievance_no,
    leadId: row.lead_id,
    source: row.source,
    category: row.category,
    description: row.description,
    ownerId: row.owner_id,
    slaDueAt: row.sla_due_at ? new Date(row.sla_due_at as unknown as string) : null,
    status: row.status,
    response: row.response,
    closureProofRef: row.closure_proof_ref,
    createdAt: new Date(row.created_at as unknown as string),
    updatedAt: new Date(row.updated_at as unknown as string),
    createdBy: row.created_by,
  };
}
