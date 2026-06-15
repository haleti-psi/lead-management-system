-- FR-100 — overdue-task domain event.
-- Adds the `TASK_OVERDUE` value to the `event_code` enum so the overdue-task
-- sweep (TaskOverdueSweepJob) can emit it to the transactional outbox. This
-- resolves the deferred FR-100-A2 amendment per cross-FR review finding M10.
ALTER TYPE event_code ADD VALUE IF NOT EXISTS 'TASK_OVERDUE';
