import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { TaskRow, WidgetError } from '@/hooks/use-dashboard';
import { EmptyState } from '@/components/common/EmptyState';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — My tasks widget: open/overdue tasks for the current user (top 20 by
 * due_at). "View all" links to the task list with open filter. Hidden for HEAD
 * role (no individual task view per visibility matrix).
 */
export interface MyTasksWidgetProps {
  rows: TaskRow[] | null;
  widgetError: WidgetError | undefined;
  visible: boolean;
  onRetry?: () => void;
}

function formatDueAt(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

export function MyTasksWidget({
  rows,
  widgetError,
  visible,
  onRetry,
}: MyTasksWidgetProps): ReactElement | null {
  if (!visible) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm font-semibold">My Tasks</CardTitle>
        </div>
        <Link
          to="/tasks?filter[status]=open"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {widgetError ? (
          <WidgetErrorState widgetName="my_tasks" onRetry={onRetry} />
        ) : rows === null || rows.length === 0 ? (
          <EmptyState title="No pending tasks." />
        ) : (
          <ul className="space-y-2" aria-label="My open tasks">
            {rows.map((row) => (
              <li key={row.task_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  <span className="font-medium capitalize">{row.type.replaceAll('_', ' ')}</span>
                  {' — '}
                  <span className="text-muted-foreground">{row.lead_code}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDueAt(row.due_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
