import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { LeadDetailPage } from '@/components/workspace/LeadDetailPage';
import { ProtectedRoute } from '@/lib/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
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
import { LeadListPage } from './leads/LeadListPage';
import { ImportLeadsPage } from './leads/import/ImportLeadsPage';
import { AdminHomePage } from './admin/AdminHomePage';
import { UserAdminPage } from './admin/users/UserAdminPage';
import { MasterDataPage } from './admin/master/MasterDataPage';
import { ProductConfigPage } from './admin/products/ProductConfigPage';
import { BreakGlassPage } from './admin/break-glass/BreakGlassPage';
import { IntegrationsPage } from './admin/integrations/IntegrationsPage';
import { ConfigGovernancePage } from '@/components/admin/ConfigGovernancePage';
import { AuditExplorerPage } from '@/pages/audit/AuditExplorerPage';
import { ReportsPage } from '@/pages/reports/ReportsPage';
import { ExportJobsPage } from '@/components/reporting/ExportJobsPage';
import { TasksPage } from '@/features/engagement/TasksPage';
import { TemplateListPage } from '@/features/admin/templates/TemplateListPage';
import { DataRightsPage } from '@/components/compliance/DataRightsPage';
import { DlaRegistryPage } from '@/pages/compliance/DlaRegistryPage';
import { ApprovalsPage } from './approvals/ApprovalsPage';

/** FR-113 — the DLA/LSP registry gates its "Add Entry" control by the caller's
 * role, so feed it the authenticated user's role from the auth context. */
function DlaRegistryRoute(): JSX.Element {
  const { user } = useAuth();
  return <DlaRegistryPage callerRole={user?.role} />;
}

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
          {/* FR-050 — Lead list / queues. */}
          <Route path="/leads" element={<LeadListPage />} />
          {/* FR-010 — Bulk lead import (CSV/Excel). */}
          <Route path="/import" element={<ImportLeadsPage />} />
          {/* FR-055 — Lead approval queue. */}
          <Route path="/approvals" element={<ApprovalsPage />} />
          {/* FR-051 — Lead 360 view. */}
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          {/* FR-052 — Pipeline board (Kanban stage view). */}
          <Route path="/pipeline" element={<PipelineBoardPage />} />
          {/* FR-070 — KYC document checklist + verification workbench. */}
          <Route path="/leads/:id/documents" element={<DocumentsPage />} />
          <Route path="/leads/:id/kyc" element={<KycPage />} />
          {/* Engagement — task & follow-up queue. */}
          <Route path="/tasks" element={<TasksPage />} />
          {/* FR-120/121 — Reports; FR-122 — my exports. */}
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/exports" element={<ExportJobsPage />} />
          {/* FR-123 — Audit trail explorer. */}
          <Route path="/audit" element={<AuditExplorerPage />} />
          {/* FR-112/113 — Compliance console. */}
          <Route path="/compliance/data-rights" element={<DataRightsPage />} />
          <Route path="/compliance/dla" element={<DlaRegistryRoute />} />
          {/* FR-090/091/092 — partner admin, console, quality. */}
          <Route path="/admin/partners" element={<PartnerManagementPage />} />
          <Route path="/partner/leads" element={<PartnerLeadsPage />} />
          <Route path="/partner/:id/quality" element={<PartnerQualityPage />} />
          {/* Configuration hub + admin consoles. */}
          <Route path="/admin" element={<AdminHomePage />} />
          <Route path="/admin/master" element={<MasterDataPage />} />
          <Route path="/admin/products" element={<ProductConfigPage />} />
          <Route path="/admin/config" element={<ConfigGovernancePage />} />
          <Route path="/admin/templates" element={<TemplateListPage />} />
          <Route path="/admin/break-glass" element={<BreakGlassPage />} />
          {/* FR-140 — Integration monitor + webhook subscriptions. */}
          <Route path="/admin/integrations" element={<IntegrationsPage />} />
          {/* FR-130 — User administration. */}
          <Route path="/users" element={<UserAdminPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
