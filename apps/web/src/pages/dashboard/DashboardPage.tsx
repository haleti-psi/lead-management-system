import type { ReactElement } from 'react';

import { useDashboard } from '@/hooks/use-dashboard';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { PageHeader } from '@/components/layout/PageHeader';

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
      <PageHeader title="Home" description="Your role-scoped overview" />
      <DashboardGrid
        data={data}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
      />
    </div>
  );
}
