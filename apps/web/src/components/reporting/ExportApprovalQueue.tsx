import type { ReactElement } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';

import { StatusChip } from '@/components/ui/StatusChip';
import { useApproveExport, useListExports } from '@/hooks/useExports';
import type { ExportJob } from '@/lib/api/exports';

interface ConfirmState {
  job: ExportJob;
}

/**
 * FR-122 — Approval queue for BM/SM/HEAD/DPO.
 * Lists jobs with status=awaiting_approval scoped to the approver's reach.
 * ConfirmDialog confirms before calling POST /exports/{id}/approve.
 */
export function ExportApprovalQueue(): ReactElement {
  const { data, isLoading, isError, refetch } = useListExports({
    'filter[status]': 'awaiting_approval',
    limit: 100,
  });
  const approveMutation = useApproveExport();
  const [confirming, setConfirming] = useState<ConfirmState | null>(null);

  const rows = data?.data ?? [];

  function handleApprove(job: ExportJob) {
    setConfirming({ job });
  }

  function confirmApprove() {
    if (!confirming) return;
    approveMutation.mutate(confirming.job.export_job_id, {
      onSuccess: () => {
        toast.success('Export approved and queued for generation.');
        setConfirming(null);
        void refetch();
      },
      onError: () => {
        toast.error('Failed to approve export. Please try again.');
        setConfirming(null);
      },
    });
  }

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading approval queue" className="space-y-2">
        {[...Array<number>(3)].map((_, i) => (
          <div key={i} className="h-8 rounded bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive text-sm">
        Failed to load approval queue.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Pending Export Approvals</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and approve large or sensitive export requests.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
          No pending approvals.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Report</th>
                <th className="px-4 py-2 text-left font-medium">Masking</th>
                <th className="px-4 py-2 text-left font-medium">Scope</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Requested</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {rows.map((job) => (
                <tr key={job.export_job_id}>
                  <td className="px-4 py-2 font-mono text-xs">{job.report_code}</td>
                  <td className="px-4 py-2 capitalize">{job.masking_level}</td>
                  <td className="px-4 py-2">{job.scope}</td>
                  <td className="px-4 py-2">
                    <StatusChip label="Awaiting approval" tone="warning" />
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => handleApprove(job)}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inline ConfirmDialog */}
      {confirming != null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="approve-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
            <h3 id="approve-dialog-title" className="text-base font-semibold">
              Approve Export?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Report: <span className="font-mono">{confirming.job.report_code}</span>
              <br />
              Masking: <span className="capitalize">{confirming.job.masking_level}</span>
              <br />
              Scope: {confirming.job.scope}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Approving will queue this export for generation. You cannot self-approve.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmApprove}
                disabled={approveMutation.isPending}
                className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {approveMutation.isPending ? 'Approving…' : 'Confirm Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
