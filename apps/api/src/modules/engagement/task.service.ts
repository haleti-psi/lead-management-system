import { Inject, Injectable } from '@nestjs/common';

import { AuditAction, DataScope, ERROR_CODES, RoleCode, TaskStatus, TaskType } from '@lms/shared';
import type { ScopePredicate } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import { LeadService } from '../capture/lead.service';
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

/**
 * FR-100 — Task Management service. Single source of business logic for
 * task create, list, and update. M11 is the SOLE writer of `tasks`.
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
