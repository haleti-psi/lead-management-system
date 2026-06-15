import type { ReactElement } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';

import { isApiClientError } from '@/lib/api';
import type { CreateExportRequest } from '@/lib/api/exports';
import { useCreateExport } from '@/hooks/useExports';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { ExportRequestForm } from './ExportRequestForm';

interface ExportButtonProps {
  reportCode: string;
  userRole: string;
}

/**
 * FR-122 — export button wired into the ReportViewer page header.
 * Opens a modal with ExportRequestForm; on success shows a toast.
 * On 409 EXPORT_APPROVAL_REQUIRED shows an "awaiting approval" toast.
 */
export function ExportButton({ reportCode, userRole }: ExportButtonProps): ReactElement {
  const [open, setOpen] = useState(false);
  const mutation = useCreateExport();

  function handleSubmit(req: CreateExportRequest) {
    mutation.mutate(
      { req },
      {
        onSuccess: (job) => {
          setOpen(false);
          if (job.status === 'queued') {
            toast.success('Export queued. You will be notified when ready.');
          } else {
            toast.info('Export requires approval. Your manager has been notified.');
          }
        },
        onError: (err) => {
          if (isApiClientError(err) && err.status === 409) {
            setOpen(false);
            toast.info('Export requires approval. Your manager has been notified.');
          } else {
            toast.error('Failed to request export. Please try again.');
          }
        },
      },
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Export
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request Export"
        description="Export this report to a CSV file. Large exports or unmasked data require manager approval."
      >
        <ExportRequestForm
          reportCode={reportCode}
          userRole={userRole}
          onSubmit={handleSubmit}
          isLoading={mutation.isPending}
        />
      </Modal>
    </>
  );
}
