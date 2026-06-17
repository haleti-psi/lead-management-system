import { Navigate, useParams } from 'react-router-dom';
import { Loader2, LinkIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { useCustomerLink } from '@/hooks/use-customer-link';
import { OtpGate } from './OtpGate';
import { CustomerHome } from './CustomerHome';

/**
 * FR-060 §UI — public customer micro-site landing at `/c/:token`. No AppShell, no
 * staff nav, no PII beyond the customer's own lead summary. Loads `GET /c/{token}`,
 * shows the OTP gate until verified, then the purpose-gated home. An invalid or
 * expired link (404) renders a friendly terminal state — never a login redirect.
 */
export function CustomerLinkPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useCustomerLink(token ?? '');

  if (!token) return <Navigate to="/" replace />;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-center justify-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground" aria-hidden>
          L
        </div>
        <span className="text-base font-semibold tracking-tight">LMS</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your application</CardTitle>
          <CardDescription>Securely complete the requested actions for your loan application.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10" role="status" aria-label="Loading">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : isError || !data ? (
            <EmptyState
              icon={<LinkIcon className="h-8 w-8" aria-hidden />}
              title="This link is no longer valid"
              message="The link may have expired or been replaced. Please contact your relationship manager for a new link."
            />
          ) : data.otp_verified ? (
            <CustomerHome token={token} data={data} />
          ) : (
            <OtpGate token={token} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
