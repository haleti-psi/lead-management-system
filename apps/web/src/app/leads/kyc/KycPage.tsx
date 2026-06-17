import { Navigate, useParams } from 'react-router-dom';
import { KycWorkbench } from '@/components/kyc/KycWorkbench';
import { PageHeader } from '@/components/layout/PageHeader';

/**
 * Standalone host for the FR-071 KYC workbench at `/leads/:id/kyc` (inside the
 * authenticated AppShell). The same `KycWorkbench` mounts in the Lead-360 KYC tab
 * once M6 lands; this page makes the feature reachable and testable on its own.
 */
export function KycPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Leads', to: '/leads' }, { label: 'Lead', to: `/leads/${id}` }, { label: 'KYC' }]}
        title="KYC"
        description="Identity verification (PAN / CKYC / DigiLocker) and exceptions."
      />
      <KycWorkbench leadId={id} />
    </div>
  );
}
