import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * Route guard for authenticated areas. While the session is bootstrapping
 * (`isLoading`, the on-mount silent refresh), it shows a spinner so a valid
 * session isn't bounced to /login on reload. Once settled, an unauthenticated
 * user is redirected to /login with the attempted location, so login can return
 * them there.
 */
export function ProtectedRoute(): JSX.Element {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
