import { type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiClient } from '@/lib/api';
import { LosStatusTimeline } from './LosStatusTimeline';
import type { LosStatusEntry, LosStatusResponse } from './los-status.types';

/** IST timezone identifier for display formatting (FR-082 UI spec U03). */
const IST_TZ = 'Asia/Kolkata';

/**
 * Format a UTC ISO datetime string into IST dd-MM-yyyy HH:mm.
 *
 * Example: '2026-06-09T10:30:00Z' → '09-06-2026 16:00' (IST +5:30).
 */
export function formatStatusDate(iso: string): string {
  const zoned = toZonedTime(new Date(iso), IST_TZ);
  return format(zoned, 'dd-MM-yyyy HH:mm');
}

/**
 * FR-082 — LOS Application Status Panel (Lead 360 read-only slot).
 *
 * Fetches mirror history via GET /api/v1/leads/{id}/los-status (view_lead
 * capability enforced server-side; this component makes no auth decision).
 *
 * States:
 *   - LoadingSkeleton while query is in-flight (T-UI U04).
 *   - EmptyState when no mirror record exists (T17, T-UI: "No LOS application linked").
 *   - ErrorState on query error — generic copy, no internal cause (T-UI U05).
 *   - LosStatusTimeline + metadata grid when data is present (T16, U01–U03).
 *
 * Roles with access: RM (O), BM (B), SM (T), HEAD (A), KYC (B).
 * PARTNER and CUSTOMER cannot see the LOS panel (auth-matrix.json).
 *
 * Accessibility: WCAG 2.1 AA — status chips use role="status" + aria-label;
 * metadata grid uses <dl>/<dt>/<dd> semantics.
 */
export function LosStatusPanel({ leadId }: { leadId: string }): ReactElement {
  const { data, isPending, isError, refetch } = useQuery<LosStatusResponse>({
    queryKey: ['los-status', leadId],
    queryFn: () => apiClient.get<LosStatusResponse>(`/leads/${leadId}/los-status`),
  });

  if (isPending) {
    return <LoadingSkeleton rows={4} />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load LOS status"
        message="Something went wrong"
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const entries: LosStatusEntry[] = data ?? [];

  if (entries.length === 0) {
    return (
      <EmptyState
        title="No LOS application linked"
        message="LOS status updates will appear here after hand-off."
      />
    );
  }

  const latest = entries[0];

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">LOS Application Status</h3>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          LOS-owned · Read-only
        </span>
      </div>

      {/* Current status metadata grid */}
      {latest !== undefined ? (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Current status</dt>
            <dd>
              <StatusChip
                status={latest.status}
                label="LOS status"
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">LOS Application ID</dt>
            <dd className="font-mono text-xs">{latest.losApplicationId}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last Updated</dt>
            <dd>{formatStatusDate(latest.statusDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source</dt>
            <dd>{latest.receivedVia === 'poll' ? 'Reconciliation poll' : 'Webhook'}</dd>
          </div>
          {latest.correlationId !== null ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Correlation ID</dt>
              <dd className="font-mono text-xs">{latest.correlationId}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {/* History timeline — all rows newest-first */}
      <LosStatusTimeline entries={entries} />
    </div>
  );
}
