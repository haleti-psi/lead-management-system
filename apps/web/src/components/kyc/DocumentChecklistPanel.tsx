import { FileText } from 'lucide-react';
import { StatusChip } from '@/components/ui/StatusChip';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { ChecklistItem } from '@/components/kyc/ChecklistItem';
import { kycStatusDisplay } from '@/components/kyc/status-display';
import { useDocumentChecklist } from '@/hooks/use-document-checklist';
import { useCan } from '@/lib/auth/capabilities';

/**
 * Document checklist panel for a lead (LLD §UI — DocumentChecklistPanel). Fetches
 * the merged checklist, renders the kyc-status summary, and lists each item with
 * its role-gated upload / waive actions. Designed to mount inside the Lead-360
 * Documents tab (M6) and also stands alone on `/leads/:id/documents`.
 */
export function DocumentChecklistPanel({ leadId }: { leadId: string }): JSX.Element {
  const { data, isLoading, isError, refetch } = useDocumentChecklist(leadId);
  const can = useCan();
  const canUpload = can('upload_doc');
  const canWaive = can('verify_doc');

  if (isLoading) return <LoadingSkeleton rows={5} />;
  if (isError || !data) {
    return <ErrorState title="Couldn't load documents" onRetry={() => void refetch()} />;
  }
  if (data.checklist.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" aria-hidden />}
        title="No documents required"
        message="This product has no document checklist configured."
      />
    );
  }

  const kyc = kycStatusDisplay(data.kyc_status);

  return (
    <section aria-label="Document checklist" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Document checklist</h2>
        <StatusChip label={kyc.label} tone={kyc.tone} />
        <span className="text-sm text-muted-foreground">
          Mandatory documents {data.mandatory_complete ? 'complete' : 'incomplete'}
        </span>
      </div>

      <ul role="list" className="rounded-md border px-4">
        {data.checklist.map((item) => (
          <ChecklistItem
            key={`${item.doc_type}:${item.applicant_scope}`}
            item={item}
            leadId={leadId}
            canUpload={canUpload}
            canWaive={canWaive}
          />
        ))}
      </ul>
    </section>
  );
}
