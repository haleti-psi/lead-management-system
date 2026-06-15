import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isApiClientError } from '@/lib/api';
import { useVerifyOtp } from '@/hooks/use-customer-link';

/**
 * FR-060 §UI — OTP step-up gate (shown when `otp_verified=false`). Six-digit
 * code, `autocomplete="one-time-code"`. A wrong code is 401 (AUTH_REQUIRED) and a
 * cap breach is 429 (RATE_LIMITED) — both surfaced inline, never as a redirect.
 */
export function OtpGate({ token }: { token: string }): JSX.Element {
  const [otp, setOtp] = React.useState('');
  const verify = useVerifyOtp(token);

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return;
    verify.mutate(otp, {
      onError: (error) => {
        if (isApiClientError(error) && error.code === 'RATE_LIMITED') {
          toast.error('Too many attempts. Please wait a few minutes and try again.');
          return;
        }
        toast.error('That code is incorrect or has expired. Please try again.');
      },
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="otp">Enter the 6-digit code sent to your phone</Label>
        <Input
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="One-time password"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
        />
      </div>
      <Button type="submit" className="w-full" disabled={otp.length !== 6 || verify.isPending}>
        {verify.isPending ? 'Verifying…' : 'Verify'}
      </Button>
    </form>
  );
}
