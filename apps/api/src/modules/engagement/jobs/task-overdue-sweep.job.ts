import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { UnitOfWork } from '../../../core/db';
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

      // TODO (FR-100-A2): emit TASK_OVERDUE outbox events once `TASK_OVERDUE` is
      // added to the `EventCode` enum in schema.sql + @lms/shared. Uncomment the
      // block below after the contracts amendment:
      //
      // for (const row of overdueRows) {
      //   await this.outbox.emit(
      //     {
      //       event_code: EventCode.TASK_OVERDUE,          // add to EventCode enum
      //       aggregate_type: 'Task',
      //       aggregate_id: row.task_id,
      //       payload: {
      //         task_id: row.task_id,
      //         lead_id: row.lead_id,
      //         owner_id: row.owner_id,
      //         sla_policy_id: row.sla_policy_id,
      //         due_at: row.due_at.toISOString(),
      //       },
      //     },
      //     tx,
      //   );
      // }

      // Warn log until outbox is wired (so operational visibility is not lost).
      this.logger.warn(
        {
          task_ids: overdueRows.map((r) => r.task_id),
          note: 'TASK_OVERDUE outbox event deferred: EventCode.TASK_OVERDUE not yet registered (FR-100-A2)',
        },
        'task-overdue-sweep: TASK_OVERDUE events not emitted — contracts amendment pending',
      );

      return overdueRows.length;
    });
  }
}
