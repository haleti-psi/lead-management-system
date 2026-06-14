import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PlugZap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { HandoffFailureWidget as HandoffFailureData, WidgetError } from '@/hooks/use-dashboard';
import { WidgetErrorState } from './WidgetErrorState';

/**
 * FR-053 — Hand-off failure widget: shows LOS integration failures for scoped
 * leads. Visible for BM, SM, HEAD only (RM: hidden per visibility matrix).
 * Each row links to the Lead 360 for retry/investigation.
 */
export interface HandoffFailureWidgetProps {
  data: HandoffFailureData | null;
  widgetError: WidgetError | undefined;
  visible: boolean;
  onRetry?: () => void;
}

export function HandoffFailureWidget({
  data,
  widgetError,
  visible,
  onRetry,
}: HandoffFailureWidgetProps): ReactElement | null {
  if (!visible) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <PlugZap className="h-4 w-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-sm font-semibold">
          Hand-off Failures
          {data && data.count > 0 ? (
            <span className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground">
              {data.count}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {widgetError ? (
          <WidgetErrorState widgetName="handoff_failures" onRetry={onRetry} />
        ) : !data || data.count === 0 ? (
          <p className="text-sm text-muted-foreground">No hand-off failures.</p>
        ) : (
          <ul className="space-y-2" aria-label="Hand-off failures">
            {data.leads.map((entry) => (
              <li key={entry.lead_id} className="flex items-center justify-between gap-2 text-sm">
                <Link
                  to={`/leads/${entry.lead_id}`}
                  className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {entry.lead_code}
                </Link>
                <span className="text-xs text-muted-foreground">
                  Last attempt: {new Date(entry.last_attempt_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
