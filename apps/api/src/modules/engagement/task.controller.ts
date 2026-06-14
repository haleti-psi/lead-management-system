import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import { Capability, Disposition, TaskStatus, TaskType } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { SCOPE_PREDICATE_KEY, type AbacRequestContext } from '../../core/auth';
import { Req } from '@nestjs/common';
import { ZodValidationPipe } from '../../core/common';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskService } from './task.service';

/**
 * Query params Zod schema for GET /tasks.
 * All fields optional; limit capped at 100 by the service.
 */
const ListTasksQueryDto = z.object({
  lead_id: z.string().uuid().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  owner_id: z.string().uuid().optional(),
  type: z.nativeEnum(TaskType).optional(),
  due_before: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

type ListTasksQueryDto = z.infer<typeof ListTasksQueryDto>;

/**
 * Path param validator: UUID task id.
 */
const TaskIdParam = z.object({
  id: z.string().uuid('Invalid task ID format.'),
});

/**
 * FR-100 + FR-102 — Task management endpoints (M11 Engagement).
 *
 * All endpoints are protected by the global JwtAuthGuard + AbacGuard
 * (`edit_lead` capability, scope-resolved per role). No `@Public()` override.
 *
 * PATCH co-ownership (FR-100 + FR-102):
 * - If `disposition` is present in the body → FR-102 path: calls
 *   `TaskService.logDisposition()`. This writes the task disposition, a
 *   CommunicationLog row, an audit entry, and an outbox event in one atomic
 *   UnitOfWork transaction. Post-commit CTI sync when CTI_ENABLED=true.
 * - If `disposition` is absent → FR-100 path: calls `TaskService.update()`.
 */
@Controller('tasks')
@Requires(Capability.EDIT_LEAD, () => ({ resourceType: 'tasks' }))
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /**
   * GET /api/v1/tasks — List tasks scoped to the caller's role/scope.
   */
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListTasksQueryDto)) query: ListTasksQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ) {
    const scopePredicate = req[SCOPE_PREDICATE_KEY];
    if (scopePredicate == null) {
      // Defensive — AbacGuard always sets this on a grant.
      throw new Error('ABAC scope predicate missing from request context');
    }

    return this.taskService.list(query, user, scopePredicate);
  }

  /**
   * POST /api/v1/tasks — Create a new task.
   * Returns 201 with the full task object.
   */
  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(CreateTaskDto)) dto: CreateTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.taskService.create(dto, user);
  }

  /**
   * PATCH /api/v1/tasks/:id — Update or complete a task (FR-100 + FR-102).
   *
   * When `disposition` is present in the body, FR-102 disposition-logging path
   * runs: atomically updates the task to `done`, inserts a CommunicationLog
   * (channel=in_app), appends an audit entry, and emits a LEAD_STAGE_CHANGED
   * outbox event. Post-commit CTI sync when `CTI_ENABLED=true` and
   * `task.type='call'` (Phase 1.5).
   *
   * Otherwise, the FR-100 general update path runs (status, owner, due_at, etc.).
   *
   * Returns 200 with the updated task object.
   */
  @Patch(':id')
  async update(
    @Param(new ZodValidationPipe(TaskIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(UpdateTaskDto)) dto: UpdateTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    // FR-102 path: disposition present → log the disposition with full side-effects
    if (dto.disposition != null) {
      // Validate disposition enum (Zod already did, but type-narrow here)
      const dispositionValue = dto.disposition as typeof Disposition[keyof typeof Disposition];
      return this.taskService.logDisposition(
        params.id,
        {
          disposition: dispositionValue,
          result_note: dto.result_note,
          next_action_at: dto.next_action_at,
          geo: dto.geo != null
            ? { lat: dto.geo.lat, lng: dto.geo.lng, accuracy_m: (dto.geo as { lat: number; lng: number; accuracy_m: number }).accuracy_m }
            : null,
        },
        user,
      );
    }

    // FR-100 path: general task update (no disposition)
    return this.taskService.update(params.id, dto, user);
  }
}
