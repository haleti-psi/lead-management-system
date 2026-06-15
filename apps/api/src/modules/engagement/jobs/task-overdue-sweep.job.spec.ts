import type { UnitOfWork } from '../../../core/db';
import type { TaskRepository } from '../task.repository';
import { TaskOverdueSweepJob } from './task-overdue-sweep.job';

function fakeRepo(overrides: Partial<TaskRepository> = {}): TaskRepository {
  return {
    markOverdue: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as TaskRepository;
}

function fakeUow(): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn({ __tx: true })),
  } as unknown as UnitOfWork;
}

function fakeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as import('nestjs-pino').PinoLogger;
}

function fakeOutbox(): { emit: jest.Mock } {
  return { emit: jest.fn().mockResolvedValue(undefined) };
}

describe('TaskOverdueSweepJob', () => {
  function makeJob(repoOverrides: Partial<TaskRepository> = {}): {
    job: TaskOverdueSweepJob;
    repo: TaskRepository;
    outbox: { emit: jest.Mock };
  } {
    const repo = fakeRepo(repoOverrides);
    const uow = fakeUow();
    const outbox = fakeOutbox();
    const logger = fakeLogger();
    const job = new TaskOverdueSweepJob(
      repo,
      uow,
      outbox as unknown as import('../../../core/outbox').OutboxService,
      logger,
    );
    return { job, repo, outbox };
  }

  // T15: marks open and in_progress tasks past due_at as overdue
  it('T15: marks open/in_progress tasks as overdue and returns count', async () => {
    const overdueRows = [
      { task_id: 'task-1', lead_id: 'lead-1', owner_id: 'user-1', sla_policy_id: null, due_at: new Date(Date.now() - 3_600_000) },
      { task_id: 'task-2', lead_id: 'lead-2', owner_id: 'user-2', sla_policy_id: null, due_at: new Date(Date.now() - 7_200_000) },
    ];
    const { job, repo } = makeJob({ markOverdue: jest.fn().mockResolvedValue(overdueRows) });

    const count = await job.run();

    expect(count).toBe(2);
    expect(repo.markOverdue).toHaveBeenCalledWith(expect.objectContaining({ __tx: true }));
  });

  // M10: emits TASK_OVERDUE to the outbox for each overdue task, in the same tx
  it('emits a TASK_OVERDUE outbox event per overdue task', async () => {
    const overdueRows = [
      { task_id: 'task-1', lead_id: 'lead-1', owner_id: 'user-1', sla_policy_id: null, due_at: new Date(Date.now() - 3_600_000) },
      { task_id: 'task-2', lead_id: 'lead-2', owner_id: 'user-2', sla_policy_id: null, due_at: new Date(Date.now() - 7_200_000) },
    ];
    const { job, outbox } = makeJob({ markOverdue: jest.fn().mockResolvedValue(overdueRows) });

    await job.run();

    expect(outbox.emit).toHaveBeenCalledTimes(2);
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_code: 'TASK_OVERDUE', aggregate_type: 'Task', aggregate_id: 'task-1' }),
      expect.anything(),
    );
  });

  // T16: does not mark tasks with future due_at
  it('T16: returns 0 when no tasks are past due_at', async () => {
    const { job, repo } = makeJob({ markOverdue: jest.fn().mockResolvedValue([]) });

    const count = await job.run();

    expect(count).toBe(0);
    expect(repo.markOverdue).toHaveBeenCalled();
  });

  // T20: transaction rollback on failure
  it('T20: propagates error when markOverdue throws (allows UnitOfWork to roll back)', async () => {
    const { job } = makeJob({ markOverdue: jest.fn().mockRejectedValue(new Error('DB failure')) });

    await expect(job.run()).rejects.toThrow('DB failure');
  });
});
