import { AlertTriangle } from 'lucide-react';

/**
 * FR-071 §UI — shown when a KYC check is in exception (mismatch or provider down).
 * Resolution is FR-072 (exception workbench), not yet routed; this banner is the
 * informational signal. Announced via `role="alert"`.
 */
export function KycExceptionBanner({ message }: { message?: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">KYC needs attention</p>
        <p className="text-sm">{message ?? 'A KYC check could not be completed. Review and resolve the exception.'}</p>
      </div>
    </div>
  );
}
