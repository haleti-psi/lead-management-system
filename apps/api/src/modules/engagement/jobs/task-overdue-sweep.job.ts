import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { EventCode } from '@lms/shared';

import { UnitOfWork } from '../../../core/db';
import { OutboxService } from '../../../core/outbox';
import { TaskRepository } from '../task.repository';

/**
 * FR-100 — Overdue sweep job (runs every ~5 minutes via Cloud Tasks).
 *
 * Batch-transitions `open` and `in_progress` tasks whose `due_at` has passed
 * to `overdue`. After the update, would emit `TASK_OVERDUE` events to the
 * outbox — DEFERRED until `TASK_OVERDUE` is added to the `EventCode` enum
 * (FR-100 AMBIGUITY.md §FR-100-A2). For now a structured warn is logged listing
 * the overdue task IDs.
 *
 * The update itself runs in a transaction so the batch is atomic; the deferred
 * outbox emit would also run in the same transaction per the LLD's spec.
 */
@Injectable()
export class TaskOverdueSweepJob {
  constructor(
    private readonly repo: TaskRepository,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(TaskOverdueSweepJob.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Execute the overdue sweep.
   *
   * @returns The number of tasks transitioned to `overdue`.
   */
  async run(): Promise<number> {
    return this.uow.run(async (tx) => {
      const overdueRows = await this.repo.markOverdue(tx);

      if (overdueRows.length === 0) {
        return 0;
      }

      this.logger.info(
        { count: overdueRows.length, task_ids: overdueRows.map((r) => r.task_id) },
        'task-overdue-sweep: marked tasks overdue',
      );

      // Emit a TASK_OVERDUE event per task in the SAME tx as the status change
      // (FR-100-A2 resolved by cross-FR review M10 — EventCode.TASK_OVERDUE added).
      for (const row of overdueRows) {
        await this.outbox.emit(
          {
            event_code: EventCode.TASK_OVERDUE,
            aggregate_type: 'Task',
            aggregate_id: row.task_id,
            payload: {
              task_id: row.task_id,
              lead_id: row.lead_id,
              owner_id: row.owner_id,
              sla_policy_id: row.sla_policy_id,
              due_at: row.due_at.toISOString(),
            },
          },
          tx,
        );
      }

      return overdueRows.length;
    });
  }
}
