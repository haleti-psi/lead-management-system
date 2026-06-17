import { Skeleton } from '@/components/ui/skeleton';

/** Shared loading state (BRD §4.5 / ui.md §States). Renders a few placeholder
 * rows while data loads. `label` sets the status region's accessible name
 * (default "Loading"); pass a more specific name where the context warrants. */
export function LoadingSkeleton({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }): JSX.Element {
  return (
    <div className="space-y-2 py-4" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
