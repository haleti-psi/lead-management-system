import { Skeleton } from '@/components/ui/skeleton';

/** Shared loading state (BRD §4.5 / ui.md §States). Renders a few placeholder
 * rows while data loads. */
export function LoadingSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-2 py-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
