import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * FR-053 — KPI card: a single metric with a semantic icon accent and a
 * drill-through link to the filtered lead list. Compact (p-4) and scannable —
 * the metric is the focal point; colour is reserved for status/semantics
 * (`tone`) and the breach `alert`, never decoration (ui.md §Design tokens).
 */
export type KpiTone = 'neutral' | 'primary' | 'positive' | 'warning' | 'destructive' | 'hot';

/** Tone → icon-chip classes. Palette tones carry a `dark:` pair for AA in both modes. */
const TONE_ICON: Readonly<Record<KpiTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  positive: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  destructive: 'bg-destructive/10 text-destructive',
  hot: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

export interface KpiCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  to: string;
  description?: string;
  /** Unit suffix rendered after the value, e.g. "%". */
  unit?: string;
  /** Semantic accent for the icon chip (default neutral). */
  tone?: KpiTone;
  /** Tint the whole card destructive when the count is > 0 (e.g. SLA breached). */
  alert?: boolean;
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  to,
  description,
  unit,
  tone = 'neutral',
  alert,
}: KpiCardProps): ReactElement {
  const isAlerting = Boolean(alert) && value > 0;
  return (
    <Link
      to={to}
      aria-label={`${title}: ${value}${unit ?? ''}${description ? `, ${description}` : ''}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        className={cn(
          'p-4 transition-colors',
          isAlerting
            ? 'border-destructive/40 bg-destructive/5 hover:bg-destructive/10'
            : 'hover:border-foreground/20 hover:bg-accent/40',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
            <p
              className={cn(
                'text-2xl font-bold leading-none tabular-nums',
                isAlerting ? 'text-destructive' : 'text-foreground',
              )}
            >
              {value}
              {unit ? (
                <span className="ml-0.5 text-base font-semibold text-muted-foreground">{unit}</span>
              ) : null}
            </p>
            {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
          </div>
          <span
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
              isAlerting ? TONE_ICON.destructive : TONE_ICON[tone],
            )}
            aria-hidden
          >
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}
