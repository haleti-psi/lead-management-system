// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * FR-053 — Inline widget-level error tile. Renders when a widget key is null
 * in the response (`widget_errors[]` contains the widget name + INTERNAL_ERROR).
 * Does not use ErrorState (which is full-page); this is a compact inline tile.
 */
export interface WidgetErrorStateProps {
  widgetName: string;
  onRetry?: () => void;
}

export function WidgetErrorState({ widgetName: _widgetName, onRetry }: WidgetErrorStateProps): ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center"
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
      <p className="text-sm font-medium text-destructive">Widget temporarily unavailable.</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      ) : null}
    </div>
  );
}
