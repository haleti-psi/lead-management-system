import { ShieldAlert } from 'lucide-react';

/**
 * FR-071 §UI — shown when `kyc` consent is not granted for the lead. The verify
 * actions are disabled client-side and the server also enforces the gate
 * (`403 CONSENT_MISSING`). Announced to assistive tech via `role="alert"`.
 */
export function ConsentGateBanner(): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">KYC consent required</p>
        <p className="text-sm">
          KYC consent has not been granted for this lead. Capture consent before running verification.
        </p>
      </div>
    </div>
  );
}
