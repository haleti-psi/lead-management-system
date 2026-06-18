import { cn } from '@/lib/utils';

/**
 * Brand mark — a rounded tile carrying the brand gradient (token-driven, so it
 * shifts correctly in dark mode) with an ascending-bars glyph signifying lead
 * progression. Decorative by default; wrap with a label where it stands alone.
 */
export function LogoMark({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-sm',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[56%] w-[56%]" fill="currentColor" aria-hidden>
        <rect x="3" y="13" width="4" height="8" rx="1.5" />
        <rect x="10" y="9" width="4" height="12" rx="1.5" />
        <rect x="17" y="4" width="4" height="17" rx="1.5" />
      </svg>
    </span>
  );
}

interface LogoProps {
  className?: string;
  markClassName?: string;
  /** Show the "Lead Management" sub-label under the LMS wordmark. */
  subtitle?: boolean;
}

/** Full lockup: mark + wordmark. Used in the app shell and sign-in. */
export function Logo({ className, markClassName, subtitle = true }: LogoProps): JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      <span className="flex flex-col leading-none">
        <span className="text-base font-semibold tracking-tight text-foreground">LMS</span>
        {subtitle ? (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Lead Management
          </span>
        ) : null}
      </span>
    </span>
  );
}
