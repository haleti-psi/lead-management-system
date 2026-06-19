import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusChip } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { isApiClientError } from '@/lib/api';
import { useLeads } from '@/hooks/use-leads';
import { useLeadApproval, approvalErrorMessage } from '@/hooks/use-lead-approval';
import type { LeadListItem } from '@/types/lead';

/**
 * FR-055 — Approvals queue. Shows leads in `pending_approval` within the
 * user's scope. Each row offers Approve / Reject actions; Reject reveals an
 * inline reason input (5–500 chars). Uses `useLeads` with a
 * `filter[stage]=pending_approval` query param so the server handles scope +
 * masking and returns only actionable rows.
 *
 * WCAG 2.1 AA:
 *   - All interactive elements have explicit aria-labels.
 *   - Errors rendered with role="alert".
 *   - Focus moves to the reason input when the Reject panel expands.
 */
export function ApprovalsPage(): JSX.Element {
  const [page, setPage] = React.useState(1);
  const limit = 25;

  const leadsQuery = useLeads({
    page,
    limit,
    sort: 'created_at:desc',
    filters: { stage: 'pending_approval' },
  });

  const result = leadsQuery.data;

  const errorMessage = leadsQuery.isError
    ? isApiClientError(leadsQuery.error) && leadsQuery.error.status === 403
      ? "You don't have permission to view the approvals queue."
      : 'Could not load approvals.'
    : null;

  const columns: DataTableColumn<LeadListItem>[] = [
    {
      id: 'lead_code',
      header: 'Lead',
      cell: (l) => (
        <Link to={`/leads/${l.lead_id}`} className="font-medium text-primary hover:underline">
          {l.lead_code}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Name',
      cell: (l) =>
        l.name_masked ? (
          <span>{l.name_masked}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: 'product_code', header: 'Product', cell: (l) => l.product_code },
    {
      id: 'kyc_status',
      header: 'KYC',
      cell: (l) => <StatusChip label={l.kyc_status.replace(/_/g, ' ')} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (l) => <ApprovalActions leadId={l.lead_id} leadCode={l.lead_code} />,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        description="Leads awaiting your approval decision."
      />

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(l) => l.lead_id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        isLoading={leadsQuery.isLoading}
        error={errorMessage}
        onRetry={() => void leadsQuery.refetch()}
        emptyTitle="No leads awaiting approval"
        emptyMessage="Leads in the pending_approval stage will appear here."
      />
    </div>
  );
}

/**
 * Inline approve / reject panel for a single lead row.
 * Reject expands a required reason textarea (5–500 chars).
 */
function ApprovalActions({
  leadId,
  leadCode,
}: {
  leadId: string;
  leadCode: string;
}): JSX.Element {
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const reasonRef = React.useRef<HTMLInputElement>(null);

  const mutation = useLeadApproval(leadId);

  // Move focus to the reason input when the reject panel opens.
  React.useEffect(() => {
    if (rejectOpen) {
      reasonRef.current?.focus();
    }
  }, [rejectOpen]);

  const handleApprove = (): void => {
    mutation.mutate(
      { decision: 'approve' },
      {
        onSuccess: () => {
          toast.success(`${leadCode} approved.`);
        },
        onError: (error) => {
          toast.error(approvalErrorMessage(error));
        },
      },
    );
  };

  const handleReject = (): void => {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      setValidationError('Reason must be at least 5 characters.');
      return;
    }
    if (trimmed.length > 500) {
      setValidationError('Reason must not exceed 500 characters.');
      return;
    }
    setValidationError(null);
    mutation.mutate(
      { decision: 'reject', reason: trimmed },
      {
        onSuccess: () => {
          toast.success(`${leadCode} rejected.`);
          setRejectOpen(false);
          setReason('');
        },
        onError: (error) => {
          toast.error(approvalErrorMessage(error));
        },
      },
    );
  };

  const handleRejectOpen = (): void => {
    setRejectOpen(true);
    setValidationError(null);
    setReason('');
  };

  const handleRejectCancel = (): void => {
    setRejectOpen(false);
    setReason('');
    setValidationError(null);
  };

  if (!rejectOpen) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={mutation.isPending}
          aria-label={`Approve lead ${leadCode}`}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRejectOpen}
          disabled={mutation.isPending}
          aria-label={`Reject lead ${leadCode}`}
        >
          Reject
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-[280px] flex-col gap-2">
      <label htmlFor={`reason-${leadId}`} className="sr-only">
        Rejection reason for {leadCode}
      </label>
      <Input
        id={`reason-${leadId}`}
        ref={reasonRef}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for rejection (5–500 chars)"
        maxLength={500}
        aria-required="true"
        aria-invalid={validationError != null}
        aria-describedby={validationError ? `reason-error-${leadId}` : undefined}
      />
      {validationError ? (
        <p
          id={`reason-error-${leadId}`}
          role="alert"
          className="text-xs text-destructive"
        >
          {validationError}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={handleReject}
          disabled={mutation.isPending}
          aria-label={`Confirm rejection of lead ${leadCode}`}
        >
          {mutation.isPending ? 'Submitting…' : 'Confirm reject'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRejectCancel}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
