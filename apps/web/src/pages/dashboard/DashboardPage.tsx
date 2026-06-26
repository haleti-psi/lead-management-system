import type { ReactElement } from 'react';

import { useDashboard } from '@/hooks/use-dashboard';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { WelcomeBanner } from '@/components/dashboard/WelcomeBanner';

/**
 * FR-053 — Dashboard home page. Fetches `GET /dashboard` via `useDashboard`
 * hook and passes data to `DashboardGrid`. All four states (loading, error,
 * empty, success) are handled in `DashboardGrid`. A personalised `WelcomeBanner`
 * (presentation only) tops the page in both desktop and mobile views.
 */
export function DashboardPage(): ReactElement {
  const { data, isLoading, isError, refetch } = useDashboard();

  return (
    <div className="space-y-6">
      <WelcomeBanner />
      <DashboardGrid
        data={data}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
      />
    </div>
  );
}
