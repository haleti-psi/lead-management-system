import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shared error state (BRD §4.5 / ui.md §States). Generic copy — never leak an
 * internal cause; offers a retry when the host provides one. */
export function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again.',
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center" role="alert">
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
