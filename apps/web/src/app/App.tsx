import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { LeadDetailPage } from '@/components/workspace/LeadDetailPage';
import { ProtectedRoute } from '@/lib/auth/ProtectedRoute';
import { LoginPage } from './login/LoginPage';
import { ResetPasswordPage } from './reset-password/ResetPasswordPage';
import { PipelineBoardPage } from './pipeline-board/page';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { DocumentsPage } from './leads/documents/DocumentsPage';
import { KycPage } from './leads/kyc/KycPage';
import { CustomerUploadPage } from './customer/CustomerUploadPage';
import { CustomerLinkPage } from './customer/CustomerLinkPage';
import { GrievancePage } from './customer/GrievancePage';
import { StatusPage } from './customer/StatusPage';
import { PartnerManagementPage } from './admin/partners/PartnerManagementPage';
import { PartnerLeadsPage } from './partner/PartnerLeadsPage';
import { PartnerQualityPage } from './partner/PartnerQualityPage';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/c/:token" element={<CustomerLinkPage />} />
      <Route path="/c/:token/upload" element={<CustomerUploadPage />} />
      <Route path="/c/:token/grievance" element={<GrievancePage />} />
      <Route path="/c/:token/status" element={<StatusPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          {/* FR-053 — Role-based dashboard & home */}
          <Route path="/" element={<DashboardPage />} />
          {/* FR-051 — Lead 360 view (the /leads list screen lands with FR-050 UI). */}
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          {/* FR-052 — Pipeline board (Kanban stage view). */}
          <Route path="/pipeline" element={<PipelineBoardPage />} />
          {/* FR-070 — KYC document checklist + verification workbench. */}
          <Route path="/leads/:id/documents" element={<DocumentsPage />} />
          <Route path="/leads/:id/kyc" element={<KycPage />} />
          {/* FR-090/091/092 — partner admin, console, quality. */}
          <Route path="/admin/partners" element={<PartnerManagementPage />} />
          <Route path="/partner/leads" element={<PartnerLeadsPage />} />
          <Route path="/partner/:id/quality" element={<PartnerQualityPage />} />

        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
