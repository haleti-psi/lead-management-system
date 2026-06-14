import type { ReactElement } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';

import type { CommLogDto, DeliveryStatus } from './use-communications';
import { useCommunicationLogs } from './use-communications';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
};

const STATUS_COLOUR: Record<DeliveryStatus, string> = {
  queued: 'bg-yellow-100 text-yellow-800',
  sent: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

function DeliveryChip({ status }: { status: DeliveryStatus }): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOUR[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Mask a mobile number: first 2 digits + xxxxxx + last 2 digits.
 * e.g. 9876543210 → 98xxxxxx10
 * FR-101 (UI-04): recipient masked to 98xxxxxx10 pattern.
 */
function maskMobile(mobile: string): string {
  if (/^\d{10}$/.test(mobile)) {
    return `${mobile.slice(0, 2)}xxxxxx${mobile.slice(-2)}`;
  }
  // Fall back for non-standard lengths (e.g. email or already masked).
  if (mobile.length <= 4) return mobile;
  return `${mobile.slice(0, 2)}${'x'.repeat(mobile.length - 4)}${mobile.slice(-2)}`;
}

/**
 * Mask an email address: ab****@domain.com pattern.
 */
function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return email;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  const visiblePrefix = local.slice(0, Math.min(2, local.length));
  return `${visiblePrefix}${'*'.repeat(Math.max(4, local.length - visiblePrefix.length))}${domain}`;
}

function maskRecipient(channel: CommLogDto['channel'], recipient: string): string {
  if (channel === 'sms' || channel === 'whatsapp') return maskMobile(recipient);
  if (channel === 'email') return maskEmail(recipient);
  return recipient;
}

// ── Main component ────────────────────────────────────────────────────────────

interface CommunicationHistoryProps {
  leadId: string;
}

/**
 * FR-101 — Communication history card for a lead's detail view.
 * Displays delivery_status + masked recipient (UI-04).
 */
export function CommunicationHistory({ leadId }: CommunicationHistoryProps): ReactElement {
  const { data, isLoading, isError } = useCommunicationLogs(leadId);

  const columns: DataTableColumn<CommLogDto>[] = [
    { id: 'channel', header: 'Channel', cell: (r) => r.channel },
    { id: 'template_id', header: 'Template', cell: (r) => r.template_id ?? '—' },
    {
      id: 'recipient',
      header: 'Recipient',
      cell: (r) => (
        <span aria-label="masked recipient">
          {maskRecipient(r.channel, r.recipient)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <DeliveryChip status={r.status} />,
    },
    {
      id: 'sent_at',
      header: 'Sent At',
      cell: (r) =>
        r.sent_at != null ? new Date(r.sent_at).toLocaleString() : '—',
    },
  ];

  if (isLoading) return <LoadingSkeleton />;
  if (isError) return <ErrorState message="Could not load communication history." />;

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold">Communication History</h3>
      {data == null || data.data.length === 0 ? (
        <EmptyState message="No messages sent yet." />
      ) : (
        <DataTable
          columns={columns}
          rows={data.data}
          getRowId={(r) => r.communication_log_id}
          pagination={{
            page: 1,
            limit: data.meta.limit,
            total: data.meta.total,
          }}
          onPageChange={() => {
            /* pagination for history is deferred */
          }}
        />
      )}
    </div>
  );
}
