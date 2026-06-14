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

import { Capability, TaskStatus, TaskType } from '@lms/shared';

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
  id: z.string().uuid('task id must be a valid UUID'),
});

/**
 * FR-100 — Task management endpoints (M11 Engagement).
 *
 * All endpoints are protected by the global JwtAuthGuard + AbacGuard
 * (`edit_lead` capability, scope-resolved per role). No `@Public()` override.
 *
 * Note on Idempotency-Key for POST /tasks (FR-100 Ambiguity 2): the header is
 * accepted but NOT enforced with Redis-backed idempotency in MVP. Document for
 * callers that network retries may create duplicate tasks; de-duplication is the
 * caller's responsibility at this stage.
 *
 * PATCH co-ownership: this controller builds the BASE update path (status,
 * disposition, geo, result_note, next_action_at, owner_id, due_at, priority).
 * FR-102 will extend disposition handling for visit/call specifics.
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
   * PATCH /api/v1/tasks/:id — Update or complete a task.
   * Returns 200 with the updated task object.
   */
  @Patch(':id')
  async update(
    @Param(new ZodValidationPipe(TaskIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(UpdateTaskDto)) dto: UpdateTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.taskService.update(params.id, dto, user);
  }
}
