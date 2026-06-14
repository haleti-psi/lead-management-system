import type { ReactElement } from 'react';

import { useDashboard } from '@/hooks/use-dashboard';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';

/**
 * FR-053 — Dashboard home page. Fetches `GET /dashboard` via `useDashboard`
 * hook and passes data to `DashboardGrid`. All four states (loading, error,
 * empty, success) are handled in `DashboardGrid`. `PageHeader` is the shell
 * top bar's page title ("Home" / "Dashboard" per AppShell nav).
 */
export function DashboardPage(): ReactElement {
  const { data, isLoading, isError, refetch } = useDashboard();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your role-scoped overview
        </p>
      </div>
      <DashboardGrid
        data={data}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
      />
    </div>
  );
}
