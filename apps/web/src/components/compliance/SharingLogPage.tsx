// @vitest-environment jsdom
/**
 * FR-111 — Data Sharing Log DPO oversight view.
 *
 * Route: /compliance/leads/:id/sharing-logs
 * Auth:  DPO only (consent_ledger scope A). Rendered inside AppShell.
 *
 * Server state via React Query (useSharingLogs hook below).
 * Table: recipient, purpose, dataCategory, consentId (short), status, sharedAt.
 * Pagination: page/limit controls (default 25, max 100).
 */

import { useState } from 'react';
import { DataTable, type DataTableColumn, type PaginationState } from '@/components/data/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { useSharingLogs, type SharingLogItem } from './useSharingLogs';

interface SharingLogPageProps {
  /** Lead UUID from the route param (:id). */
  leadId: string;
}

// ── Column definitions ─────────────────────────────────────────────────────────

const COLUMNS: DataTableColumn<SharingLogItem>[] = [
  {
    id: 'recipient',
    header: 'Recipient',
    cell: (row) => <span className="font-mono text-sm">{row.recipient}</span>,
  },
  {
    id: 'purpose',
    header: 'Purpose',
    cell: (row) => <StatusChip status={row.purpose} label="Purpose" />,
  },
  {
    id: 'dataCategory',
    header: 'Data Category',
    cell: (row) => <StatusChip status={row.dataCategory} label="Data category" />,
  },
  {
    id: 'consentId',
    header: 'Consent Reference',
    cell: (row) =>
      row.consentId ? (
        <span className="font-mono text-xs text-slate-600 dark:text-slate-400" title={row.consentId}>
          {row.consentId.slice(0, 8) + '…'}
        </span>
      ) : (
        <span className="text-slate-400 dark:text-slate-500">—</span>
      ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusChip status={row.status} label="Share status" />,
  },
  {
    id: 'sharedAt',
    header: 'Shared At',
    cell: (row) => (
      <time dateTime={row.sharedAt} className="text-sm text-slate-600 dark:text-slate-400">
        {formatIst(row.sharedAt)}
      </time>
    ),
  },
];

/**
 * Format an ISO timestamp in IST (Asia/Kolkata) for display. Falls back to a
 * plain locale string if the Intl API is unavailable (e.g. in Node/jsdom).
 */
function formatIst(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

// ── Page component ─────────────────────────────────────────────────────────────

/**
 * DPO Sharing Log Page — renders the paginated `data_sharing_logs` table for a
 * single lead. Handles loading, error, and empty states (UI-01–UI-04).
 */
export function SharingLogPage({ leadId }: SharingLogPageProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const { data, isLoading, isError } = useSharingLogs({ leadId, page, limit });

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError || !data) {
    return (
      <ErrorState message="Unable to load data sharing log. Please try again." />
    );
  }

  const rows = data.data;
  const pagination: PaginationState = {
    page: data.meta.pagination.page,
    limit: data.meta.pagination.limit,
    total: data.meta.pagination.total,
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No sharing events"
        message="No data has been shared with third parties for this lead yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Data Sharing Log</h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">{pagination.total} event(s)</span>
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        getRowId={(row) => row.dataShareLogId}
        pagination={pagination}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
      />
    </div>
  );
}
