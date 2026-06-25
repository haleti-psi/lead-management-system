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
 * due_at). Each row shows a task-type icon, a priority badge and a relative,
 * colour-coded due time (overdue in red). Hidden for HEAD role.
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
                {rows.map((row) => {
                  const Icon = TYPE_ICON[row.type] ?? ClipboardList;
                  const due = dueRelative(row.due_at);
                  return (
                    <TableRow key={row.task_id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                            aria-hidden
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="font-medium capitalize">{row.type.replaceAll('_', ' ')}</span>
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              PRIORITY_BADGE[row.priority] ?? PRIORITY_BADGE.low,
                            )}
                          >
                            {row.priority}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.lead_code}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                        <span
                          className={cn(
                            due.overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                          )}
                          title={formatDueAbsolute(row.due_at)}
                        >
                          {due.text}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
