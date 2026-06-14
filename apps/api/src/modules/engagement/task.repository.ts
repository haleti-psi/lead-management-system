import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { ScopePredicate } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { Tasks } from '../../core/db/types.generated';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { CreateTaskDto } from './dto/create-task.dto';

/** Read shape of a `tasks` row. */
export type TaskRow = Selectable<Tasks>;

export interface ListTaskFilters {
  lead_id?: string;
  status?: TaskRow['status'];
  owner_id?: string;
  type?: TaskRow['type'];
  due_before?: Date;
  page: number;
  limit: number;
}

/** System actor for sweep-job writes (not a real user). */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** Base joined query for scope-filtered task lists. */
function taskListBase(db: KyselyDb | DbTransaction) {
  return db
    .selectFrom('tasks as t')
    .innerJoin('leads as l', 'l.lead_id', 't.lead_id')
    .where('t.org_id', '=', ORG_ID_DEFAULT);
}

type TaskListBase = ReturnType<typeof taskListBase>;

/** Apply ABAC scope predicate to a task list query (same pattern as lead-scope.service). */
function applyTaskScope(qb: TaskListBase, scope: ScopePredicate): TaskListBase {
  switch (scope.type) {
    case 'own':
      // RM: tasks owned by caller OR tasks on leads owned by caller
      return qb.where((eb) =>
        eb.or([
          eb('t.owner_id', '=', scope.userId),
          eb('l.owner_id', '=', scope.userId),
        ]),
      );
    case 'branch':
      return qb.where('l.branch_id', '=', scope.branchId);
    case 'team':
      return scope.userIds.length > 0
        ? qb.where('l.owner_id', 'in', [...scope.userIds])
        : qb.where((eb) => eb.val(false));
    case 'region':
      return scope.branchIds.length > 0
        ? qb.where('l.branch_id', 'in', [...scope.branchIds])
        : qb.where((eb) => eb.val(false));
    case 'all':
    case 'masked':
      return qb; // all org tasks visible
    default:
      // PARTNER/CUSTOMER — no task access
      return qb.where((eb) => eb.val(false));
  }
}

/** Apply optional list filters to the joined query. */
function applyFilters(
  qb: TaskListBase,
  filters: Omit<ListTaskFilters, 'page' | 'limit'>,
): TaskListBase {
  let q = qb;
  if (filters.lead_id != null) {
    q = q.where('t.lead_id', '=', filters.lead_id);
  }
  if (filters.status != null) {
    q = q.where('t.status', '=', filters.status);
  }
  if (filters.owner_id != null) {
    q = q.where('t.owner_id', '=', filters.owner_id);
  }
  if (filters.type != null) {
    q = q.where('t.type', '=', filters.type);
  }
  if (filters.due_before != null) {
    q = q.where('t.due_at', '<=', filters.due_before);
  }
  return q;
}

/**
 * FR-100 — owner repository for the `tasks` table (M11 is the sole writer).
 * All queries are parameterised Kysely, org-scoped, and every list is
 * LIMIT-bounded (NFR-17: ≤ 100 rows). Scope filtering applied via ABAC
 * `ScopePredicate` from `AbacGuard`.
 */
@Injectable()
export class TaskRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Paginated list of tasks, scope-filtered per auth-matrix (FR-100 §Data Operations).
   * Scope is applied by joining `leads` for branch/team predicates.
   */
  async list(filters: ListTaskFilters, scope: ScopePredicate): Promise<TaskRow[]> {
    const limit = Math.min(filters.limit, 100);
    const offset = (filters.page - 1) * limit;

    const base = applyFilters(applyTaskScope(taskListBase(this.db), scope), filters);

    return base
      .selectAll('t')
      .orderBy('t.due_at', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  /** Count of tasks matching the same scope + filters (for pagination meta). */
  async count(filters: Omit<ListTaskFilters, 'page' | 'limit'>, scope: ScopePredicate): Promise<number> {
    const base = applyFilters(applyTaskScope(taskListBase(this.db), scope), filters);

    const row = await base
      .select((eb) => eb.fn.countAll<string>().as('cnt'))
      .executeTakeFirstOrThrow();
    return Number(row.cnt);
  }

  /** Insert a new task row. Runs in the caller's UnitOfWork transaction. */
  async insert(
    data: CreateTaskDto & {
      org_id: string;
      created_by: string;
      updated_by: string;
    },
    tx: DbTransaction,
  ): Promise<TaskRow> {
    return tx
      .insertInto('tasks')
      .values({
        org_id: data.org_id,
        lead_id: data.lead_id,
        type: data.type,
        owner_id: data.owner_id,
        due_at: new Date(data.due_at),
        priority: data.priority,
        sla_policy_id: data.sla_policy_id ?? null,
        status: 'open',
        disposition: null,
        result_note: data.result_note ?? null,
        geo: data.geo != null ? JSON.stringify(data.geo) : null,
        next_action_at: data.next_action_at != null ? new Date(data.next_action_at) : null,
        created_by: data.created_by,
        updated_by: data.updated_by,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Fetch one task by id, scoped to the org. Returns null when not found or
   * in a different org.
   */
  async findById(taskId: string): Promise<TaskRow | null> {
    const row = await this.db
      .selectFrom('tasks')
      .selectAll()
      .where('task_id', '=', taskId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * FR-102 — Fetch task + its lead's branch_id for scope resolution.
   * Used by the ABAC scope resolver before the guard runs.
   * Returns null when task does not exist in the org.
   */
  async findByIdWithLead(
    taskId: string,
  ): Promise<(TaskRow & { branch_id: string | null; lead_owner_id: string | null }) | null> {
    const row = await this.db
      .selectFrom('tasks')
      .innerJoin('leads', 'leads.lead_id', 'tasks.lead_id')
      .select([
        'tasks.task_id',
        'tasks.org_id',
        'tasks.lead_id',
        'tasks.type',
        'tasks.status',
        'tasks.owner_id',
        'tasks.disposition',
        'tasks.result_note',
        'tasks.geo',
        'tasks.next_action_at',
        'tasks.priority',
        'tasks.sla_policy_id',
        'tasks.due_at',
        'tasks.created_at',
        'tasks.updated_at',
        'tasks.created_by',
        'tasks.updated_by',
        'leads.branch_id',
        'leads.owner_id as lead_owner_id',
      ])
      .where('tasks.task_id', '=', taskId)
      .where('tasks.org_id', '=', ORG_ID_DEFAULT)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  /** Update a task row. Runs in the caller's UnitOfWork transaction. */
  async update(
    taskId: string,
    patch: Partial<{
      status: TaskRow['status'];
      disposition: TaskRow['disposition'];
      result_note: string | null;
      geo: unknown;
      next_action_at: Date | null;
      owner_id: string;
      due_at: Date;
      priority: TaskRow['priority'];
    }> & { updated_by: string },
    tx: DbTransaction,
  ): Promise<TaskRow> {
    const updates: Record<string, unknown> = {
      updated_at: new Date(),
      updated_by: patch.updated_by,
    };

    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.disposition !== undefined) updates.disposition = patch.disposition;
    if ('result_note' in patch) updates.result_note = patch.result_note;
    if ('geo' in patch) updates.geo = patch.geo != null ? JSON.stringify(patch.geo) : null;
    if ('next_action_at' in patch) updates.next_action_at = patch.next_action_at;
    if (patch.owner_id !== undefined) updates.owner_id = patch.owner_id;
    if (patch.due_at !== undefined) updates.due_at = patch.due_at;
    if (patch.priority !== undefined) updates.priority = patch.priority;

    return tx
      .updateTable('tasks')
      .set(updates)
      .where('task_id', '=', taskId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Overdue sweep: batch-update tasks past due_at from open/in_progress to overdue.
   * Returns the task_ids + lead_ids + owner_ids + sla_policy_ids of updated rows
   * (for the outbox event emission in the sweep job — deferred per FR-100-A2).
   */
  async markOverdue(
    tx: DbTransaction,
  ): Promise<Array<{ task_id: string; lead_id: string | null; owner_id: string; sla_policy_id: string | null; due_at: Date }>> {
    const now = new Date();
    return tx
      .updateTable('tasks')
      .set({ status: 'overdue', updated_at: now, updated_by: SYSTEM_ACTOR_ID })
      .where('status', 'in', ['open', 'in_progress'])
      .where('due_at', '<', now)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returning(['task_id', 'lead_id', 'owner_id', 'sla_policy_id', 'due_at'])
      .execute();
  }
}
