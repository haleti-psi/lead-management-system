import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityForm, FormField } from '@/components/forms/EntityForm';
import { useAuth } from '@/hooks/use-auth';
import { isApiClientError } from '@/lib/api';

const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});
type LoginValues = z.infer<typeof LoginSchema>;

const MfaSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
type MfaValues = z.infer<typeof MfaSchema>;

/** Maps an auth error to the toast text FR-001 specifies. Bad credentials
 * (AUTH_REQUIRED) use a non-enumerating message. */
function notifyAuthError(error: unknown): void {
  if (isApiClientError(error)) {
    switch (error.code) {
      case 'RATE_LIMITED':
        toast.error('Too many attempts. Please wait and try again.');
        return;
      case 'FORBIDDEN':
        toast.error('Your account is locked. Contact your admin.');
        return;
      case 'AUTH_REQUIRED':
        toast.error('Invalid username or password.');
        return;
      default:
        break;
    }
  }
  toast.error('Something went wrong. Please try again.');
}

export function LoginPage(): JSX.Element {
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const onLogin = async (values: LoginValues): Promise<void> => {
    const result = await login(values.username, values.password);
    if (result.mfaRequired) {
      setChallengeToken(result.challengeToken);
    } else {
      navigate(from, { replace: true });
    }
  };

  const onVerify = async (values: MfaValues): Promise<void> => {
    if (!challengeToken) return;
    await verifyMfa(challengeToken, values.otp);
    navigate(from, { replace: true });
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader className="space-y-3 text-center">
          <div
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground"
            aria-hidden
          >
            L
          </div>
          <CardTitle>{challengeToken ? 'Two-factor authentication' : 'Sign in to LMS'}</CardTitle>
        </CardHeader>
        <CardContent>
          {challengeToken ? (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Enter the 6-digit code from your authenticator app.
              </p>
              <EntityForm<MfaValues>
                schema={MfaSchema}
                defaultValues={{ otp: '' }}
                onSubmit={onVerify}
                onError={notifyAuthError}
                submitLabel="Verify"
              >
                <FormField
                  name="otp"
                  label="One-time code"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </EntityForm>
            </>
          ) : (
            <EntityForm<LoginValues>
              schema={LoginSchema}
              defaultValues={{ username: '', password: '' }}
              onSubmit={onLogin}
              onError={notifyAuthError}
              submitLabel="Sign in"
            >
              <FormField name="username" label="Username" autoComplete="username" required />
              <FormField
                name="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                required
              />
            </EntityForm>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
