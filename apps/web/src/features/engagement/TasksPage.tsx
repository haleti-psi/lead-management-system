import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';

import type { TaskDto, TaskFilters } from './use-tasks';
import { useTasks } from './use-tasks';
import { TaskFiltersBar } from './TaskFilters';
import { TaskModal } from './TaskModal';
import { OverdueQueuePanel } from './OverdueQueuePanel';

/** Status chip — maps task_status values to colour classes. */
function StatusChip({ status }: { status: TaskDto['status'] }): ReactElement {
  const colourMap: Record<TaskDto['status'], string> = {
    open: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-yellow-100 text-yellow-800',
    done: 'bg-green-100 text-green-800',
    overdue: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
  };
  const labelMap: Record<TaskDto['status'], string> = {
    open: 'Open',
    in_progress: 'In Progress',
    done: 'Done',
    overdue: 'Overdue',
    cancelled: 'Cancelled',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colourMap[status]}`}>
      {labelMap[status]}
    </span>
  );
}

/** Priority badge. */
function PriorityBadge({ priority }: { priority: TaskDto['priority'] }): ReactElement {
  const colourMap: Record<TaskDto['priority'], string> = {
    low: 'text-gray-500',
    normal: 'text-blue-600',
    high: 'text-orange-600',
  };
  const label = priority.charAt(0).toUpperCase() + priority.slice(1);
  return <span className={`text-xs font-medium ${colourMap[priority]}`}>{label}</span>;
}

/** Table columns for the task list. */
const COLUMNS: DataTableColumn<TaskDto>[] = [
  {
    id: 'type',
    header: 'Type',
    cell: (row) => (
      <span className="capitalize">{row.type.replace(/_/g, ' ')}</span>
    ),
  },
  {
    id: 'lead_id',
    header: 'Lead',
    cell: (row) => (
      <span className="font-mono text-xs">{row.lead_id.slice(0, 8)}…</span>
    ),
  },
  {
    id: 'owner_id',
    header: 'Assignee',
    cell: (row) => (
      <span className="font-mono text-xs">{row.owner_id.slice(0, 8)}…</span>
    ),
  },
  {
    id: 'due_at',
    header: 'Due',
    cell: (row) => (
      <time dateTime={row.due_at} className="text-sm">
        {new Date(row.due_at).toLocaleString()}
      </time>
    ),
  },
  {
    id: 'priority',
    header: 'Priority',
    cell: (row) => <PriorityBadge priority={row.priority} />,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusChip status={row.status} />,
  },
  {
    id: 'disposition',
    header: 'Disposition',
    cell: (row) =>
      row.disposition ? (
        <span className="capitalize text-sm">{row.disposition.replace(/_/g, ' ')}</span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
  },
];

/**
 * FR-100 — Tasks page container.
 *
 * Shows:
 *  - PageHeader with "Create Task" button
 *  - OverdueQueuePanel (collapsed by default)
 *  - TaskFiltersBar
 *  - DataTable (server-paginated)
 *  - EmptyState / LoadingSkeleton / ErrorState
 *  - TaskModal (create or update)
 */
export function TasksPage(): ReactElement {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<TaskFilters>({ page: 1, limit: 25 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskDto | null>(null);

  const { data, isLoading, isError, error, refetch } = useTasks(filters);

  // On 403 navigate to forbidden
  if (isApiError(error, 403)) {
    navigate('/forbidden');
  }

  function handlePageChange(page: number) {
    setFilters((f) => ({ ...f, page }));
  }

  const tasks = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage follow-up activities for your leads
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Create Task
        </button>
      </div>

      {/* Overdue queue */}
      <OverdueQueuePanel />

      {/* Filters */}
      <TaskFiltersBar filters={filters} onChange={setFilters} />

      {/* Task list */}
      {isLoading ? (
        <LoadingSkeleton rows={5} />
      ) : isError ? (
        <ErrorState message="Failed to load tasks." onRetry={refetch} />
      ) : tasks.length === 0 ? (
        <EmptyState title="No tasks found" message="Try adjusting the filters or create a new task." />
      ) : (
        <>
          <DataTable
            rows={tasks}
            columns={COLUMNS}
            getRowId={(row) => row.task_id}
            pagination={{ page: meta?.page ?? 1, limit: meta?.limit ?? 25, total: meta?.total ?? 0 }}
            onPageChange={handlePageChange}
          />
        </>
      )}

      {/* Create modal */}
      {showCreateModal ? (
        <TaskModal
          mode="create"
          callerId="" // caller user id — provided by the auth context in production
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            void refetch();
          }}
        />
      ) : null}

      {/* Update modal */}
      {selectedTask ? (
        <TaskModal
          mode="update"
          task={selectedTask}
          canReassign={false} // will be derived from the auth context / role in production
          onClose={() => setSelectedTask(null)}
          onSuccess={() => {
            setSelectedTask(null);
            void refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function isApiError(err: unknown, status: number): boolean {
  return err != null && typeof err === 'object' && 'status' in err && (err as { status: number }).status === status;
}
