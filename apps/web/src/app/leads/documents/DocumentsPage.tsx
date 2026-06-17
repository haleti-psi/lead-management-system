import { Navigate, useParams } from 'react-router-dom';
import { DocumentChecklistPanel } from '@/components/kyc/DocumentChecklistPanel';
import { PageHeader } from '@/components/layout/PageHeader';

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
      <PageHeader
        breadcrumbs={[{ label: 'Leads', to: '/leads' }, { label: 'Lead', to: `/leads/${id}` }, { label: 'Documents' }]}
        title="Documents"
        description="Document checklist, upload and verification status."
      />
      <DocumentChecklistPanel leadId={id} />
    </div>
  );
}
