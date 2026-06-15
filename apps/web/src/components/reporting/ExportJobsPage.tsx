import type { ReactElement } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ChipTone } from '@/components/ui/StatusChip';
import { StatusChip } from '@/components/ui/StatusChip';
import { useGetExport, useListExports } from '@/hooks/useExports';
import type { JobStatus } from '@lms/shared';

const STATUS_TONE: Readonly<Record<string, ChipTone>> = {
  queued: 'info',
  running: 'progress',
  completed: 'success',
  failed: 'danger',
  awaiting_approval: 'warning',
};

/**
 * FR-122 — "My Exports" tab on the Reports page.
 * Lists the actor's export jobs with pagination and a Download button for completed jobs.
 */
export function ExportJobsPage(): ReactElement {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useListExports({ page, limit: 25 });

  const rows = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const hasNext = page * 25 < total;

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading exports" className="space-y-2">
        {[...Array<number>(5)].map((_, i) => (
          <div key={i} className="h-8 rounded bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive text-sm">
        Failed to load export history.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
        No exports yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Report</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Masking</th>
              <th className="px-4 py-2 text-right font-medium">Rows</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
              <th className="px-4 py-2 text-left font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {rows.map((job) => (
              <tr key={job.export_job_id}>
                <td className="px-4 py-2 font-mono text-xs">{job.report_code}</td>
                <td className="px-4 py-2">
                  <StatusChip
                    label={job.status.replace('_', ' ')}
                    tone={STATUS_TONE[job.status] ?? 'neutral'}
                  />
                </td>
                <td className="px-4 py-2 capitalize">{job.masking_level}</td>
                <td className="px-4 py-2 text-right">{job.row_count ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(job.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  {job.status === 'completed' && (
                    <DownloadButton jobId={job.export_job_id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-end gap-2 text-sm">
        <button
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded border px-3 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <span className="py-1 text-muted-foreground">Page {page}</span>
        <button
          disabled={!hasNext}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Download button — fetches signed URL on click then opens it in a new tab. */
function DownloadButton({ jobId }: { jobId: string }): ReactElement {
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading } = useGetExport(jobId, { enabled });

  function handleDownload() {
    if (data?.download_url) {
      window.open(data.download_url, '_blank', 'noopener,noreferrer');
    } else {
      setEnabled(true);
    }
  }

  // When data arrives from the hook, open the URL
  if (data?.download_url && enabled) {
    window.open(data.download_url, '_blank', 'noopener,noreferrer');
    toast.success('Download started.');
  }

  return (
    <button
      type="button"
      disabled={isLoading}
      onClick={handleDownload}
      className="text-sm text-primary underline disabled:opacity-40"
    >
      {isLoading ? 'Getting link…' : 'Download'}
    </button>
  );
}

/** Export so it can be used as a named export in page-level tests. */
export type { JobStatus };
