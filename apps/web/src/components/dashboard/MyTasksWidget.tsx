import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { TaskRow, WidgetError } from '@/hooks/use-dashboard';
import { EmptyState } from '@/components/common/EmptyState';
import { WidgetErrorState } from './WidgetErrorState';
import { cn } from '@/lib/utils';

/**
 * FR-053 — My tasks widget: open/overdue tasks for the current user (top 20 by
 * due_at), shown as a compact table. "View all" links to the task list with the
 * open filter. Hidden for HEAD role (no individual task view per visibility matrix).
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

/** Priority → indicator dot colour (semantic). */
const PRIORITY_DOT: Readonly<Record<string, string>> = {
  high: 'bg-destructive',
  medium: 'bg-warning',
  low: 'bg-muted-foreground/40',
};

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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide">Task</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide">Lead</TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">
                    Due
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.task_id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            PRIORITY_DOT[row.priority] ?? 'bg-muted-foreground/40',
                          )}
                          aria-hidden
                        />
                        <span className="font-medium capitalize">{row.type.replaceAll('_', ' ')}</span>
                        <span className="sr-only">{row.priority} priority</span>
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.lead_code}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                      {formatDueAt(row.due_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
