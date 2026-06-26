import type { ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Shared page header (ui.md §Layout). Standardises the page title hierarchy,
 * optional description, optional breadcrumb trail (context) and a right-aligned
 * actions slot — so every screen reads consistently. Margin-less by default;
 * the host controls spacing (pass `className="mb-4"` or place inside a
 * `space-y-*` container).
 */
export interface Breadcrumb {
  label: string;
  /** Omit `to` for the current (last) crumb — rendered as plain text. */
  to?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  /** Optional back-arrow link shown above the title (preferred over breadcrumbs
   * for drill-in sections, e.g. Configuration consoles). */
  backTo?: string;
  backLabel?: string;
  /** Right-aligned actions (buttons, badges) — wraps below the title on mobile. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  backTo,
  backLabel,
  actions,
  className,
}: PageHeaderProps): JSX.Element {
  // Router-dependent links render only when a Router is present (so a page
  // rendered standalone — e.g. in a unit test — doesn't crash).
  const inRouter = useInRouterContext();
  return (
    <div className={cn(className)}>
      {backTo && inRouter ? (
        <Link
          to={backTo}
          className="mb-2 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel ? `Back to ${backLabel}` : 'Back'}
        </Link>
      ) : null}
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <ChevronRight className="h-3 w-3 shrink-0" aria-hidden /> : null}
                {crumb.to && inRouter ? (
                  <Link
                    to={crumb.to}
                    className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={crumb.to ? undefined : 'page'}
                    className={crumb.to ? 'text-muted-foreground' : 'text-foreground'}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
