/**
 * FR-115 — Retention Policy DataTable.
 */

import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import {
  DATA_CATEGORY_LABELS,
  LEAD_OUTCOME_LABELS,
  RETENTION_ACTION_LABELS,
  type RetentionPolicy,
} from '@/components/compliance/retention.types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

interface RetentionPolicyTableProps {
  rows: RetentionPolicy[];
  pagination: { page: number; limit: number; total: number };
  isLoading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}

const columns: DataTableColumn<RetentionPolicy>[] = [
  {
    id: 'data_category',
    header: 'Data Category',
    cell: (row) => (
      <span className="font-medium text-gray-900">
        {DATA_CATEGORY_LABELS[row.data_category] ?? row.data_category}
      </span>
    ),
  },
  {
    id: 'lead_outcome',
    header: 'Lead Outcome',
    cell: (row) => (
      <span className="text-sm text-gray-600">
        {row.lead_outcome ? (LEAD_OUTCOME_LABELS[row.lead_outcome] ?? row.lead_outcome) : '—'}
      </span>
    ),
  },
  {
    id: 'retain_days',
    header: 'Retain (days)',
    cell: (row) => <span className="text-sm text-gray-600">{row.retain_days}</span>,
  },
  {
    id: 'action',
    header: 'Action',
    cell: (row) => (
      <span className="text-sm text-gray-600">
        {RETENTION_ACTION_LABELS[row.action] ?? row.action}
      </span>
    ),
  },
  {
    id: 'legal_hold',
    header: 'Legal Hold',
    cell: (row) => (
      <span className={`text-sm font-medium ${row.legal_hold ? 'text-red-600' : 'text-gray-400'}`}>
        {row.legal_hold ? 'Yes' : 'No'}
      </span>
    ),
  },
  {
    id: 'is_active',
    header: 'Status',
    cell: (row) => <StatusChip status={row.is_active ? 'active' : 'inactive'} />,
  },
  {
    id: 'updated_at',
    header: 'Updated',
    cell: (row) => <span className="text-sm text-gray-500">{formatDate(row.updated_at)}</span>,
  },
];

export function RetentionPolicyTable({
  rows,
  pagination,
  isLoading,
  error,
  onPageChange,
  onRetry,
}: RetentionPolicyTableProps): JSX.Element {
  return (
    <DataTable<RetentionPolicy>
      columns={columns}
      rows={rows}
      getRowId={(row) => row.retention_policy_id}
      pagination={pagination}
      onPageChange={onPageChange}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      emptyTitle="No retention policies"
      emptyMessage="Create a policy to configure data retention for this organisation."
    />
  );
}
