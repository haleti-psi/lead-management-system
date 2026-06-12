import { Navigate, Route, Routes } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ProtectedRoute } from '@/lib/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import { LoginPage } from './login/LoginPage';
import { ResetPasswordPage } from './reset-password/ResetPasswordPage';

// Temporary authenticated landing until AppShell (role-filtered nav, top bar,
// mobile bottom nav) lands as the next foundation piece.
function DashboardPlaceholder(): JSX.Element {
  const { user, logout } = useAuth();
  return (
    <main className="container mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold">Lead Management System</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user?.role} (scope {user?.scope}). AppShell and feature screens follow.
      </p>
      <Button className="mt-4" variant="outline" onClick={logout}>
        Sign out
      </Button>
    </main>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPlaceholder />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
