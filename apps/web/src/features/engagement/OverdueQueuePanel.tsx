import { useState, type ReactElement } from 'react';

import { EmptyState } from '@/components/common/EmptyState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';

import type { TaskDisposition, TaskDto } from './use-tasks';
import { useTasks, useUpdateTask } from './use-tasks';

/**
 * Quick-complete drawer for a single overdue task (disposition + result note).
 * Rendered in-page (no full modal); accessible via role="dialog".
 */
function QuickCompleteDrawer({
  task,
  onClose,
  onSuccess,
}: {
  task: TaskDto;
  onClose: () => void;
  onSuccess: () => void;
}): ReactElement {
  const [disposition, setDisposition] = useState<TaskDisposition | ''>('');
  const [resultNote, setResultNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync, isPending } = useUpdateTask(task.task_id);

  async function handleComplete() {
    if (!disposition) {
      setError('Disposition is required to complete a task.');
      return;
    }
    try {
      await mutateAsync({ status: 'done', disposition, result_note: resultNote || null });
      onSuccess();
      onClose();
    } catch {
      setError('Failed to complete task. Please try again.');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-complete-title"
      className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-background p-6 shadow-lg"
    >
      <h3 id="quick-complete-title" className="mb-4 text-base font-semibold">
        Complete task
      </h3>
      {error ? (
        <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="quick-disposition">
            Disposition <span aria-hidden>*</span>
          </label>
          <select
            id="quick-disposition"
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as TaskDisposition | '')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— select —</option>
            <option value="connected">Connected</option>
            <option value="no_answer">No Answer</option>
            <option value="wrong_number">Wrong Number</option>
            <option value="not_interested">Not Interested</option>
            <option value="visited">Visited</option>
            <option value="rescheduled">Rescheduled</option>
            <option value="callback_requested">Callback Requested</option>
            <option value="docs_promised">Docs Promised</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="quick-result-note">
            Result note
          </label>
          <textarea
            id="quick-result-note"
            value={resultNote}
            onChange={(e) => setResultNote(e.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {isPending ? 'Completing…' : 'Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * FR-100 — Overdue queue panel. Collapsible section showing all overdue tasks
 * sorted by `due_at` ascending. Each row has a quick-complete action.
 */
export function OverdueQueuePanel(): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<TaskDto | null>(null);

  const { data, isLoading, refetch } = useTasks({ status: 'overdue', limit: 100 });

  const overdueCount = data?.meta.total ?? 0;

  function handleSuccess() {
    void refetch();
    setActiveTask(null);
  }

  return (
    <section aria-labelledby="overdue-panel-title" className="rounded-lg border border-destructive/30 bg-destructive/5">
      <button
        type="button"
        id="overdue-panel-title"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-destructive"
        aria-expanded={isOpen}
        aria-controls="overdue-panel-body"
      >
        <span>
          Overdue tasks
          {overdueCount > 0 ? (
            <span
              className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground"
              aria-label={`${overdueCount} overdue`}
            >
              {overdueCount}
            </span>
          ) : null}
        </span>
        <span aria-hidden>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen ? (
        <div id="overdue-panel-body" className="border-t border-destructive/20 px-4 pb-4 pt-2">
          {isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : !data?.data.length ? (
            <EmptyState title="No overdue tasks" />
          ) : (
            <div className="divide-y divide-border">
              {data.data.map((task) => (
                <div key={task.task_id} className="flex items-center justify-between py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium capitalize">{task.type.replace('_', ' ')}</p>
                    <p className="text-xs text-muted-foreground">
                      Due: {new Date(task.due_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTask(task)}
                    className="ml-3 rounded-md border border-destructive px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    Complete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {activeTask ? (
        <QuickCompleteDrawer
          task={activeTask}
          onClose={() => setActiveTask(null)}
          onSuccess={handleSuccess}
        />
      ) : null}
    </section>
  );
}
