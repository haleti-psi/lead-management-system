import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

/** Shared empty state (BRD §4.5). Every data view renders this when there is no
 * data (ui.md §States). */
export function EmptyState({
  title = 'Nothing here yet',
  message,
  icon,
  action,
}: {
  title?: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/40 px-6 py-12 text-center"
      role="status"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </span>
      <div className="space-y-1">
        <p className="font-semibold text-foreground">{title}</p>
        {message ? <p className="mx-auto max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
