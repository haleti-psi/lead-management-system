import { cn } from '@/lib/utils';

/**
 * Status chip for entity-status enums (ui.md §States). A small, accessible badge
 * whose colour encodes a semantic tone. Used by FR-070 for `doc_status` and
 * `kyc_status`; the `tone` is chosen by the host from the value so this stays a
 * dumb presentational primitive (no enum coupling).
 */
export type ChipTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Readonly<Record<ChipTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  progress: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  warning: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};

export function StatusChip({
  label,
  tone = 'neutral',
  className,
}: {
  label: string;
  tone?: ChipTone;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
