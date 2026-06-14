import { Navigate, useParams } from 'react-router-dom';
import { DocumentChecklistPanel } from '@/components/kyc/DocumentChecklistPanel';

/**
 * Standalone host for the FR-070 document checklist at `/leads/:id/documents`
 * (renders inside the authenticated AppShell). The same `DocumentChecklistPanel`
 * is intended to mount in the Lead-360 Documents tab once M6 lands; this page
 * makes the feature reachable and testable on its own in the meantime.
 */
export function DocumentsPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Documents</h1>
      <DocumentChecklistPanel leadId={id} />
    </div>
  );
}
