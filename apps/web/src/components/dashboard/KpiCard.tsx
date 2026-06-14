import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * FR-053 — KPI card: displays a single metric count with an icon and a
 * drill-through link to the lead list with appropriate filters.
 */
export interface KpiCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  to: string;
  description?: string;
  /** Highlight in amber when the count is > 0 (e.g. SLA breached). */
  alert?: boolean;
}

export function KpiCard({ title, value, icon: Icon, to, description, alert }: KpiCardProps): ReactElement {
  return (
    <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
      <Card
        className={
          alert && value > 0
            ? 'border-destructive/40 bg-destructive/5 transition-colors hover:bg-destructive/10'
            : 'transition-colors hover:bg-accent/50'
        }
      >
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          <p
            className={`text-2xl font-bold ${alert && value > 0 ? 'text-destructive' : ''}`}
            aria-label={`${title}: ${value}`}
          >
            {value}
          </p>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </CardContent>
      </Card>
    </Link>
  );
}
