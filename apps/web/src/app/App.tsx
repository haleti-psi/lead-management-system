import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { LeadDetailPage } from '@/components/workspace/LeadDetailPage';
import { ProtectedRoute } from '@/lib/auth/ProtectedRoute';
import { LoginPage } from './login/LoginPage';
import { ResetPasswordPage } from './reset-password/ResetPasswordPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          {/* FR-053 — Role-based dashboard & home */}
          <Route path="/" element={<DashboardPage />} />
          {/* FR-051 — Lead 360 view (the /leads list screen lands with FR-050 UI). */}
          <Route path="/leads/:id" element={<LeadDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
