import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  MapPin,
  Phone,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { TaskRow, WidgetError } from '@/hooks/use-dashboard';
import { EmptyState } from '@/components/common/EmptyState';
import { WidgetErrorState } from './WidgetErrorState';
import { cn } from '@/lib/utils';

/**
 * FR-053 — My tasks widget: open/overdue tasks for the current user, grouped by
 * task category with a per-category count (and a total on the header). Each task
 * shows its lead, priority and a relative, colour-coded due time. Hidden for HEAD.
 */
export interface MyTasksWidgetProps {
  rows: TaskRow[] | null;
  widgetError: WidgetError | undefined;
  visible: boolean;
  onRetry?: () => void;
}

/** Task type → icon (falls back to a generic clipboard). */
const TYPE_ICON: Readonly<Record<string, LucideIcon>> = {
  call: Phone,
  callback: PhoneCall,
  visit: MapPin,
  doc_request: FileText,
  kyc_appt: ShieldCheck,
  dealer_followup: Users,
  approval: CheckCircle2,
  handoff_retry: RefreshCw,
  nurture: Sparkles,
};

/** Priority → badge classes (semantic, AA in both themes). */
const PRIORITY_BADGE: Readonly<Record<string, string>> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
};

function formatDueAbsolute(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function dueRelative(isoString: string): { text: string; overdue: boolean } {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return { text: isoString, overdue: false };
  return { text: formatDistanceToNowStrict(d, { addSuffix: true }), overdue: d.getTime() < Date.now() };
}

/** Group tasks by type, preserving due order within a group; biggest groups first. */
function groupByType(rows: TaskRow[]): Array<[string, TaskRow[]]> {
  const groups = new Map<string, TaskRow[]>();
  for (const row of rows) {
    const list = groups.get(row.type);
    if (list) list.push(row);
    else groups.set(row.type, [row]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

export function MyTasksWidget({
  rows,
  widgetError,
  visible,
  onRetry,
}: MyTasksWidgetProps): ReactElement | null {
  if (!visible) return null;

  const hasRows = rows !== null && rows.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm font-semibold">My Tasks</CardTitle>
          {hasRows ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {rows.length} pending
            </span>
          ) : null}
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
        ) : !hasRows ? (
          <EmptyState title="No pending tasks." />
        ) : (
          <div className="space-y-3">
            {groupByType(rows).map(([type, tasks]) => {
              const Icon = TYPE_ICON[type] ?? ClipboardList;
              return (
                <div key={type}>
                  {/* Category header + count of pending in this category */}
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                      aria-hidden
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      {type.replaceAll('_', ' ')}
                    </span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {tasks.length}
                    </span>
                  </div>
                  <ul className="ml-3 space-y-1 border-l pl-4">
                    {tasks.map((task) => {
                      const due = dueRelative(task.due_at);
                      return (
                        <li
                          key={task.task_id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {task.lead_code}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.low,
                              )}
                            >
                              {task.priority}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'shrink-0 whitespace-nowrap text-xs tabular-nums',
                              due.overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                            )}
                            title={formatDueAbsolute(task.due_at)}
                          >
                            {due.text}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
