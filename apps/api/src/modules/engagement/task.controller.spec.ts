import { DataScope, RoleCode, TaskStatus, TaskType, Priority } from '@lms/shared';
import type { ScopePredicate } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { SCOPE_PREDICATE_KEY } from '../../core/auth';
import { TaskController } from './task.controller';
import type { TaskRow } from './task.repository';
import { TaskService } from './task.service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TASK_ID = '00000000-0000-0000-0001-000000000001';
const LEAD_ID = '00000000-0000-0000-0002-000000000001';
const OWNER_ID = '00000000-0000-0000-0003-000000000001';

const RM_USER: AuthUser = {
  userId: OWNER_ID,
  orgId: ORG_ID,
  role: RoleCode.RM,
  scope: DataScope.O,
  jti: 'jti-rm',
};

function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    task_id: TASK_ID,
    org_id: ORG_ID,
    lead_id: LEAD_ID,
    type: TaskType.CALL,
    owner_id: OWNER_ID,
    due_at: new Date(Date.now() + 3_600_000),
    priority: Priority.NORMAL,
    sla_policy_id: null,
    status: TaskStatus.OPEN,
    disposition: null,
    result_note: null,
    geo: null,
    next_action_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: OWNER_ID,
    updated_by: OWNER_ID,
    ...overrides,
  } as TaskRow;
}

function fakeTaskService(): TaskService {
  return {
    list: jest.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 25, total: 0 } }),
    create: jest.fn().mockResolvedValue(makeTaskRow()),
    update: jest.fn().mockResolvedValue(makeTaskRow()),
  } as unknown as TaskService;
}

function makeReq(scopePredicate: ScopePredicate): { [SCOPE_PREDICATE_KEY]?: ScopePredicate } {
  return { [SCOPE_PREDICATE_KEY]: scopePredicate };
}

const ownScope: ScopePredicate = { type: 'own', userId: OWNER_ID };

describe('TaskController', () => {
  let controller: TaskController;
  let service: TaskService;

  beforeEach(() => {
    service = fakeTaskService();
    controller = new TaskController(service);
  });

  describe('list', () => {
    it('delegates to TaskService.list with scope predicate', async () => {
      const query = { page: 1, limit: 25 };
      const req = makeReq(ownScope);

      const result = await controller.list(query, RM_USER, req as unknown as Parameters<typeof controller.list>[2]);

      expect(service.list).toHaveBeenCalledWith(query, RM_USER, ownScope);
      expect(result).toEqual({ data: [], meta: { page: 1, limit: 25, total: 0 } });
    });
  });

  describe('create', () => {
    it('delegates to TaskService.create and returns task', async () => {
      const dto = {
        lead_id: LEAD_ID,
        type: TaskType.CALL,
        owner_id: OWNER_ID,
        due_at: new Date(Date.now() + 3_600_000).toISOString(),
        priority: Priority.NORMAL,
      };

      const result = await controller.create(dto, RM_USER);

      expect(service.create).toHaveBeenCalledWith(dto, RM_USER);
      expect(result.task_id).toBe(TASK_ID);
    });
  });

  describe('update', () => {
    it('delegates to TaskService.update and returns updated task', async () => {
      const dto = { status: TaskStatus.IN_PROGRESS };

      const result = await controller.update({ id: TASK_ID }, dto, RM_USER);

      expect(service.update).toHaveBeenCalledWith(TASK_ID, dto, RM_USER);
      expect(result.task_id).toBe(TASK_ID);
    });
  });
});
