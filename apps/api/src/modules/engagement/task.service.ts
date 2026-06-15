import { Inject, Injectable } from '@nestjs/common';

import { AuditAction, DataScope, Disposition, ERROR_CODES, EventCode, IntegrationKind, RoleCode, TaskStatus, TaskType } from '@lms/shared';
import type { ScopePredicate } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { AppConfigService } from '../../core/config';
import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { IntegrationGateway } from '../../core/integration';
import { TELEPHONY_PORT, type TelephonyPort } from '../../core/integration/ports/telephony.port';
import { OutboxService } from '../../core/outbox';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import { LeadService } from '../capture/lead.service';
import { CommunicationRepository } from './communication.repository';
import { canTransition } from './task-state-machine';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { TaskRow } from './task.repository';
import { TaskRepository } from './task.repository';

/** Roles that can reassign `owner_id` on a task. */
const REASSIGN_ROLES = new Set<string>([RoleCode.BM, RoleCode.SM, RoleCode.HEAD]);

/** Projected list response type. */
export interface TaskListResult {
  data: TaskRow[];
  meta: { page: number; limit: number; total: number };
}

/** Roles with team scope (SM in auth-matrix). */
const TEAM_SCOPE_ROLES = new Set<string>([RoleCode.SM]);
/** Roles with branch scope (BM, KYC in auth-matrix). */
const BRANCH_SCOPE_ROLES = new Set<string>([RoleCode.BM, RoleCode.KYC]);

/** Dispositions that require `next_action_at` to be set. */
const DISPOSITION_REQUIRES_NEXT_ACTION = new Set<string>([
  Disposition.RESCHEDULED,
  Disposition.CALLBACK_REQUESTED,
]);

/** Task types for which geo is permitted. */
const GEO_PERMITTED_TYPES = new Set<string>([TaskType.CALL, TaskType.VISIT]);

/**
 * FR-100 — Task Management service. Single source of business logic for
 * task create, list, and update. M11 is the SOLE writer of `tasks`.
 *
 * FR-102 — Adds `logDisposition()` for call/visit disposition with:
 *   - CommunicationLog (channel='in_app') in same UnitOfWork transaction
 *   - Audit entry (action='lead_update', entity_type='tasks')
 *   - Outbox event (event_code='LEAD_STAGE_CHANGED')
 *   - Optional post-commit CTI disposition sync (Phase 1.5, non-blocking)
 *
 * Auth rules:
 *  - All endpoints require JwtAuthGuard + AbacGuard `edit_lead` capability.
 *  - Scope filtering for list is applied via the ABAC-resolved ScopePredicate.
 *  - RM cannot reassign owner_id on PATCH (→ FORBIDDEN 403).
 *  - RM cannot assign a task to another user (create with owner_id != self → FORBIDDEN).
 *  - Nurture task completion → LeadService.setNurtureNextAt in same transaction.
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly repo: TaskRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly leadService: LeadService,
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly commRepo: CommunicationRepository,
    private readonly outbox: OutboxService,
    private readonly gateway: IntegrationGateway,
    @Inject(TELEPHONY_PORT) private readonly telephonyPort: TelephonyPort,
    private readonly config: AppConfigService,
  ) {}

  /**
   * List tasks visible to the caller (scope-filtered, paginated, LIMIT ≤ 100).
   */
  async list(
    filters: {
      lead_id?: string;
      status?: TaskRow['status'];
      owner_id?: string;
      type?: TaskRow['type'];
      due_before?: string;
      page?: number;
      limit?: number;
    },
    caller: AuthUser,
    scopePredicate: ScopePredicate,
  ): Promise<TaskListResult> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));

    // RM-only: owner_id filter restricted to themselves
    const ownerFilter = this.resolveOwnerFilter(filters.owner_id, caller);

    const listFilters = {
      lead_id: filters.lead_id,
      status: filters.status,
      owner_id: ownerFilter,
      type: filters.type,
      due_before: filters.due_before != null ? new Date(filters.due_before) : undefined,
      page,
      limit,
    };

    const [rows, total] = await Promise.all([
      this.repo.list(listFilters, scopePredicate),
      this.repo.count(
        {
          lead_id: listFilters.lead_id,
          status: listFilters.status,
          owner_id: listFilters.owner_id,
          type: listFilters.type,
          due_before: listFilters.due_before,
        },
        scopePredicate,
      ),
    ]);

    return { data: rows, meta: { page, limit, total } };
  }

  /**
   * Create a new task. Validates lead, owner, and SLA policy references, then
   * inserts the task + audit entry in one UnitOfWork transaction.
   */
  async create(dto: CreateTaskDto, caller: AuthUser): Promise<TaskRow> {
    // FR-100-A4: RM can only assign to themselves
    if (caller.role === RoleCode.RM && dto.owner_id !== caller.userId) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'RM may only assign tasks to themselves.' },
      });
    }

    // Validate due_at is in the future
    const dueAt = new Date(dto.due_at);
    if (dueAt <= new Date()) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'due_at', issue: 'due_at must be a future date and time.' }],
      });
    }

    // Verify lead exists and is in scope (ABAC already enforced at guard; verify existence)
    const leadExists = await this.db
      .selectFrom('leads')
      .select(['lead_id'])
      .where('lead_id', '=', dto.lead_id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!leadExists) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Verify owner_id references an active user in the org
    const ownerExists = await this.db
      .selectFrom('users')
      .select(['user_id'])
      .where('user_id', '=', dto.owner_id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!ownerExists) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'owner_id', issue: 'owner_id must reference a valid user in the organisation.' }],
      });
    }

    // Verify SLA policy if provided
    if (dto.sla_policy_id != null) {
      const policyExists = await this.db
        .selectFrom('sla_policies')
        .select(['sla_policy_id'])
        .where('sla_policy_id', '=', dto.sla_policy_id)
        .where('org_id', '=', ORG_ID_DEFAULT)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (!policyExists) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'sla_policy_id', issue: 'sla_policy_id must reference an active SLA policy.' }],
        });
      }
    }

    return this.uow.run(async (tx) => {
      const task = await this.repo.insert(
        {
          ...dto,
          org_id: ORG_ID_DEFAULT,
          created_by: caller.userId,
          updated_by: caller.userId,
        },
        tx,
      );

      // Audit: task_create intent (using LEAD_UPDATE + detail.op per FR-100-A1)
      await this.audit.append(
        {
          action: AuditAction.LEAD_UPDATE,
          entity_type: 'tasks',
          entity_id: task.task_id,
          actor_id: caller.userId,
          org_id: ORG_ID_DEFAULT,
          lead_id: dto.lead_id,
          detail: {
            op: 'task_create',
            task_id: task.task_id,
            type: dto.type,
            owner_id: dto.owner_id,
            due_at: dueAt.toISOString(),
          },
        },
        tx,
      );

      return task;
    });
  }

  /**
   * FR-102 — Log a disposition on a call or visit task.
   *
   * When `disposition` is present in the PATCH body, this method is called
   * instead of (or after) the base `update()` path. It atomically:
   *   1. Updates the task row (sets disposition, result_note, geo, next_action_at,
   *      status → done) using a `WHERE status != 'done'` guard for idempotency.
   *   2. Inserts a CommunicationLog row (channel='in_app', status='sent').
   *   3. Appends an audit entry (action='lead_update', entity_type='tasks').
   *   4. Emits a LEAD_STAGE_CHANGED outbox event.
   *
   * Post-commit (Phase 1.5, non-blocking): when CTI_ENABLED and task.type='call',
   * calls IntegrationGateway.call('TelephonyPort') to sync the disposition. A CTI
   * failure does NOT roll back the already-committed disposition; it returns 503.
   *
   * @throws DomainException CONFLICT (409) — task already done or cancelled.
   * @throws DomainException VALIDATION_ERROR (400) — geo on non-call/visit task,
   *   or next_action_at missing for rescheduled/callback_requested.
   * @throws DomainException NOT_FOUND (404) — task does not exist.
   * @throws DomainException UPSTREAM_UNAVAILABLE (503) — CTI port failure (Phase 1.5).
   */
  async logDisposition(
    taskId: string,
    dto: {
      disposition: string;
      result_note?: string | null;
      next_action_at?: string | null;
      geo?: { lat: number; lng: number; accuracy_m: number } | null;
    },
    caller: AuthUser,
  ): Promise<TaskRow> {
    // Load the task (with lead's branch_id for scope resolution and guards).
    // AbacGuard already verified the caller has edit_lead on this task resource.
    const task = await this.repo.findByIdWithLead(taskId);
    if (!task) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // FR-102: only RM and BM may log disposition (auth-matrix role restriction).
    // AbacGuard enforces capability, but other roles (SM, HEAD, KYC) also have
    // edit_lead — we restrict disposition logging to RM/BM explicitly.
    const callerIsRm = caller.role === RoleCode.RM;
    const callerIsBm = caller.role === RoleCode.BM;
    if (!callerIsRm && !callerIsBm) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // Guard: disposition only on an active task — DONE and CANCELLED are terminal.
    // The disposition UPDATE has no status WHERE clause, so this pre-check is the
    // sole gate (a cancelled task would otherwise be dispositioned).
    if (task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'Task is already closed.');
    }

    // Guard: geo only permitted for call/visit tasks
    if (dto.geo != null && !GEO_PERMITTED_TYPES.has(task.type)) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'geo', issue: 'geo is only permitted on call or visit tasks.' }],
      });
    }

    // Guard: next_action_at required for rescheduled/callback_requested
    if (DISPOSITION_REQUIRES_NEXT_ACTION.has(dto.disposition) && dto.next_action_at == null) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [
          {
            field: 'next_action_at',
            issue: 'next_action_at is required for rescheduled or callback_requested dispositions.',
          },
        ],
      });
    }

    // Guard: next_action_at must be in the future if provided
    if (dto.next_action_at != null) {
      const nextAt = new Date(dto.next_action_at);
      if (nextAt <= new Date()) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'next_action_at', issue: 'next_action_at must be a future datetime.' }],
        });
      }
    }

    // All writes in one atomic transaction (LLD §Transaction Boundaries)
    const updated = await this.uow.run(async (tx) => {
      // 2a. UPDATE tasks: disposition, status → done, result_note, geo, next_action_at
      // WHERE status != 'done' guards against duplicate logging (idempotency).
      const updatedTask = await tx
        .updateTable('tasks')
        .set({
          disposition: dto.disposition as TaskRow['disposition'],
          result_note: dto.result_note ?? null,
          geo: dto.geo != null ? JSON.stringify(dto.geo) : null,
          next_action_at: dto.next_action_at != null ? new Date(dto.next_action_at) : null,
          status: TaskStatus.DONE,
          updated_at: new Date(),
          updated_by: caller.userId,
        })
        .where('task_id', '=', taskId)
        .where('org_id', '=', ORG_ID_DEFAULT)
        .where('status', '!=', TaskStatus.DONE)
        .returningAll()
        .executeTakeFirst();

      if (!updatedTask) {
        // Task transitioned to done concurrently (or cancelled)
        throw new DomainException(ERROR_CODES.CONFLICT, 'Task already completed.');
      }

      // 2b. Insert CommunicationLog — internal activity log (not a customer message).
      // lead_id is always non-null for a scoped task (tasks always reference a lead).
      const commLeadId = updatedTask.lead_id ?? task.lead_id;
      if (commLeadId == null) {
        throw new DomainException(ERROR_CODES.INTERNAL_ERROR, 'Task has no lead_id.');
      }
      await this.commRepo.insertInternal(
        {
          lead_id: commLeadId,
          recipient: updatedTask.owner_id,
          created_by: caller.userId,
        },
        tx,
      );

      // 2c. Audit entry — result_note intentionally excluded (may contain free text)
      await this.audit.append(
        {
          action: AuditAction.LEAD_UPDATE,
          entity_type: 'tasks',
          entity_id: taskId,
          actor_id: caller.userId,
          org_id: ORG_ID_DEFAULT,
          lead_id: updatedTask.lead_id ?? undefined,
          detail: {
            event: 'disposition_logged',
            disposition: dto.disposition,
            task_type: updatedTask.type,
            has_geo: dto.geo != null,
          },
        },
        tx,
      );

      // 2d. Outbox event — contactability / downstream metrics (FR-121)
      await this.outbox.emit(
        {
          event_code: EventCode.LEAD_STAGE_CHANGED,
          aggregate_type: 'tasks',
          aggregate_id: taskId,
          payload: {
            lead_id: updatedTask.lead_id,
            task_type: updatedTask.type,
            disposition: dto.disposition,
            actor_id: caller.userId,
          },
        },
        tx,
      );

      return updatedTask;
    });

    // Phase 1.5 — CTI post-commit disposition sync (non-blocking).
    // The transaction is already committed; a CTI failure does NOT roll back.
    if (this.config.get('CTI_ENABLED') && task.type === TaskType.CALL) {
      await this.gateway.call(
        this.telephonyPort,
        {
          integration: IntegrationKind.CTI,
          leadId: task.lead_id,
          maskedRequestRef: null,
          payload: {
            action: 'log_disposition',
            task_id: taskId,
            disposition: dto.disposition,
          },
        },
        { idempotencyKey: `cti-${taskId}-${dto.disposition}` },
      );
    }

    return updated;
  }

  /**
   * Update or complete a task. Enforces ABAC ownership check, state machine
   * transitions, disposition requirement, and RM reassign block.
   */
  async update(taskId: string, dto: UpdateTaskDto, caller: AuthUser): Promise<TaskRow> {
    // Fetch current task
    const task = await this.repo.findById(taskId);
    if (!task) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Ownership check: caller must be task owner OR BM/SM/HEAD
    const canActOnTask =
      task.owner_id === caller.userId ||
      REASSIGN_ROLES.has(caller.role) ||
      this.hasBranchOrTeamScope(caller);

    if (!canActOnTask) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // RM cannot reassign owner_id
    if (dto.owner_id !== undefined && caller.role === RoleCode.RM) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'owner_id can only be changed by BM or SM.' },
      });
    }

    // Status transition validation
    if (dto.status !== undefined) {
      if (!canTransition(task.status, dto.status)) {
        throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
          detail: { reason: 'Invalid status transition for this task.' },
        });
      }
    }

    // Disposition required when completing.
    // Edge case (LLD §UpdateTaskDto): if the task already carries a disposition
    // from a prior update, we skip the requirement — the caller need not re-send
    // it. Only when both the incoming dto AND the persisted row lack a disposition
    // do we reject the transition to DONE.
    const newStatus = dto.status ?? task.status;
    if (newStatus === TaskStatus.DONE && dto.disposition == null && task.disposition == null) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'disposition', issue: 'disposition is required when completing a task.' }],
      });
    }

    // Validate new owner exists if provided
    if (dto.owner_id !== undefined) {
      const ownerExists = await this.db
        .selectFrom('users')
        .select(['user_id'])
        .where('user_id', '=', dto.owner_id)
        .where('org_id', '=', ORG_ID_DEFAULT)
        .where('status', '=', 'active')
        .executeTakeFirst();

      if (!ownerExists) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'owner_id', issue: 'owner_id must reference a valid user in the organisation.' }],
        });
      }
    }

    const fromStatus = task.status;

    return this.uow.run(async (tx) => {
      const geoValue = dto.geo !== undefined
        ? dto.geo
        : undefined;

      const updated = await this.repo.update(
        taskId,
        {
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.disposition !== undefined && { disposition: dto.disposition }),
          ...'result_note' in dto && { result_note: dto.result_note ?? null },
          ...('geo' in dto && { geo: geoValue }),
          ...('next_action_at' in dto && {
            next_action_at: dto.next_action_at != null ? new Date(dto.next_action_at) : null,
          }),
          ...(dto.owner_id !== undefined && { owner_id: dto.owner_id }),
          ...(dto.due_at !== undefined && { due_at: new Date(dto.due_at) }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          updated_by: caller.userId,
        },
        tx,
      );

      // Nurture task completed with next_action_at: update leads.nurture_next_at
      if (
        dto.status === TaskStatus.DONE &&
        task.type === TaskType.NURTURE &&
        dto.next_action_at != null &&
        task.lead_id != null
      ) {
        await this.leadService.setNurtureNextAt(task.lead_id, new Date(dto.next_action_at), tx);
      }

      // Audit: task_update intent
      await this.audit.append(
        {
          action: AuditAction.LEAD_UPDATE,
          entity_type: 'tasks',
          entity_id: taskId,
          actor_id: caller.userId,
          org_id: ORG_ID_DEFAULT,
          lead_id: task.lead_id,
          detail: {
            op: 'task_update',
            from_status: fromStatus,
            to_status: dto.status ?? fromStatus,
            disposition: dto.disposition,
          },
        },
        tx,
      );

      return updated;
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * RM cannot filter by a different owner_id. BM/SM/HEAD can.
   * Returns undefined when the caller has scope O and no owner_id was requested.
   */
  private resolveOwnerFilter(requestedOwnerId: string | undefined, caller: AuthUser): string | undefined {
    if (caller.scope === DataScope.O) {
      // RM-scoped: always restrict to themselves, ignore requested owner_id
      return caller.userId;
    }
    return requestedOwnerId;
  }

  /** True when the caller holds branch or team scope (BM/KYC or SM). */
  private hasBranchOrTeamScope(caller: AuthUser): boolean {
    return (
      BRANCH_SCOPE_ROLES.has(caller.role) ||
      TEAM_SCOPE_ROLES.has(caller.role) ||
      caller.role === RoleCode.HEAD
    );
  }
}
