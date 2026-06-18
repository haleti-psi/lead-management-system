import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { toast } from 'sonner';
import { Clock, ShieldCheck, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityForm, FormField } from '@/components/forms/EntityForm';
import { Logo } from '@/components/brand/Logo';
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

/** Product highlights shown on the sign-in brand panel — truthful capability
 * statements (no fabricated metrics), reflecting the BRD feature set. */
const HIGHLIGHTS = [
  { icon: Clock, text: 'Capture a qualified lead in under 3 minutes' },
  { icon: ShieldCheck, text: 'KYC, consent & an immutable audit trail, built in' },
  { icon: TrendingUp, text: 'Live pipeline, scoring & SLA tracking end-to-end' },
] as const;

function BrandPanel(): JSX.Element {
  return (
    <aside className="brand-aurora relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
      {/* Wordmark (frosted, reads on the gradient) */}
      <div className="relative z-10 flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur">
          <svg viewBox="0 0 24 24" className="h-[56%] w-[56%]" fill="currentColor" aria-hidden>
            <rect x="3" y="13" width="4" height="8" rx="1.5" />
            <rect x="10" y="9" width="4" height="12" rx="1.5" />
            <rect x="17" y="4" width="4" height="17" rx="1.5" />
          </svg>
        </span>
        <span className="text-base font-semibold tracking-tight">LMS</span>
      </div>

      {/* Headline + highlights */}
      <div className="relative z-10 max-w-md">
        <h1 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight">
          Originate faster.
          <br />
          Convert smarter.
        </h1>
        <p className="mt-5 text-pretty text-base/relaxed text-white/80">
          From first capture to disbursal — one compliant pipeline for every lead, relationship
          manager, and partner.
        </p>
        <ul className="mt-9 space-y-4">
          {HIGHLIGHTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-white/90">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/20">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      {/* Trust ribbon */}
      <div className="relative z-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-medium uppercase tracking-wider text-white/70">
        <span>DPDPA-ready</span>
        <span aria-hidden>·</span>
        <span>Full audit trail</span>
        <span aria-hidden>·</span>
        <span>Role-based access</span>
      </div>
    </aside>
  );
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
    <main className="grid min-h-[100dvh] lg:grid-cols-2">
      <BrandPanel />

      {/* Auth column */}
      <div className="flex items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-[400px] animate-fade-in-up">
          {/* Mobile-only logo (brand panel is hidden below lg) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo />
          </div>

          <Card className="shadow-lg">
            <CardHeader className="space-y-1.5 text-center">
              <CardTitle className="text-2xl">
                {challengeToken ? 'Two-factor authentication' : 'Welcome back'}
              </CardTitle>
              <CardDescription>
                {challengeToken
                  ? 'One more step to keep your account secure.'
                  : 'Sign in to your LMS workspace to continue.'}
              </CardDescription>
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
                  <div className="text-right">
                    <Link
                      to="/reset-password"
                      className="rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Forgot password?
                    </Link>
                  </div>
                </EntityForm>
              )}
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Protected workspace · access is monitored and audited
          </p>
        </div>
      </div>
    </main>
  );
}
