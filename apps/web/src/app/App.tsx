import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { LeadDetailPage } from '@/components/workspace/LeadDetailPage';
import { ProtectedRoute } from '@/lib/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import { LoginPage } from './login/LoginPage';
import { ResetPasswordPage } from './reset-password/ResetPasswordPage';
import { PipelineBoardPage } from './pipeline-board/page';

// Temporary landing inside the shell until feature screens (FRs) are wired.
function DashboardPlaceholder(): JSX.Element {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user?.role} (scope {user?.scope}). Feature screens follow per FR.
      </p>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPlaceholder />} />
          {/* FR-051 — Lead 360 view (the /leads list screen lands with FR-050 UI). */}
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          {/* FR-052 — Pipeline board (Kanban stage view). */}
          <Route path="/pipeline" element={<PipelineBoardPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
