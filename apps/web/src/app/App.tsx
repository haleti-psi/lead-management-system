import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/lib/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import { LoginPage } from './login/LoginPage';
import { ResetPasswordPage } from './reset-password/ResetPasswordPage';
import { DocumentsPage } from './leads/documents/DocumentsPage';
import { CustomerUploadPage } from './customer/CustomerUploadPage';

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
      <Route path="/c/:token/upload" element={<CustomerUploadPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPlaceholder />} />
          <Route path="/leads/:id/documents" element={<DocumentsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
