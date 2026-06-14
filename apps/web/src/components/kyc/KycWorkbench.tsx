import * as React from 'react';
import { KycType } from '@lms/shared';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConsentGateBanner } from '@/components/kyc/ConsentGateBanner';
import { KycExceptionBanner } from '@/components/kyc/KycExceptionBanner';
import { KycCheckRow } from '@/components/kyc/KycCheckRow';
import { isApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth/capabilities';
import { useRunKyc } from '@/hooks/use-kyc';
import type { KycVerificationData } from '@/types/kyc';

/** The KYC checks shown in the workbench. PAN is MVP; the rest are Phase 1.5
 * (disabled until their adapters land — LLD §UI / Assumption 2). */
const CHECKS: ReadonlyArray<{ type: KycType; label: string; enabled: boolean; requiresPan?: boolean }> = [
  { type: KycType.PAN, label: 'PAN', enabled: true, requiresPan: true },
  { type: KycType.CKYC, label: 'CKYC', enabled: false },
  { type: KycType.DIGILOCKER, label: 'DigiLocker', enabled: false },
  { type: KycType.AADHAAR_OTP, label: 'Aadhaar OTP', enabled: false },
  { type: KycType.VCIP, label: 'Video KYC (V-CIP)', enabled: false },
];

/**
 * FR-071 §UI — KYC workbench for a lead (Lead-360 KYC tab / standalone). Runs
 * checks via `POST /leads/{id}/kyc/{type}` and reflects each result inline. There
 * is no KYC list GET (AMBIGUITY FR-071-10), so status is driven by the mutation
 * results; the consent gate surfaces reactively on `403 CONSENT_MISSING`.
 */
export function KycWorkbench({ leadId }: { leadId: string }): JSX.Element {
  const can = useCan();
  const canVerify = can('verify_doc');
  const run = useRunKyc(leadId);

  const [results, setResults] = React.useState<Partial<Record<KycType, KycVerificationData>>>({});
  const [consentMissing, setConsentMissing] = React.useState(false);
  const [exceptionMessage, setExceptionMessage] = React.useState<string | null>(null);
  const [pendingType, setPendingType] = React.useState<KycType | null>(null);

  const hasException =
    exceptionMessage != null ||
    Object.values(results).some((r) => r && (r.status === 'failed' || r.status === 'exception'));

  function verify(kycType: KycType, panValue?: string): void {
    setPendingType(kycType);
    run.mutate(
      { kycType, body: panValue ? { pan: panValue } : {} },
      {
        onSuccess: (data) => {
          setResults((prev) => ({ ...prev, [kycType]: data }));
          setConsentMissing(false);
          if (data.status === 'success') {
            setExceptionMessage(null);
            toast.success(`${kycType.toUpperCase()} verified.`);
          } else {
            setExceptionMessage('A KYC check returned a mismatch. Resolve the exception to continue.');
            toast.error('KYC check returned a mismatch.');
          }
        },
        onError: (error) => handleError(error),
        onSettled: () => setPendingType(null),
      },
    );
  }

  function handleError(error: unknown): void {
    if (isApiClientError(error)) {
      if (error.code === 'FORBIDDEN' && error.detail?.reason === 'CONSENT_MISSING') {
        setConsentMissing(true);
        toast.error('KYC consent is required for this lead.');
        return;
      }
      if (error.code === 'UPSTREAM_UNAVAILABLE') {
        setExceptionMessage('The verification provider is temporarily unavailable. An exception was created.');
        toast.error("A service is temporarily unavailable. We'll retry.");
        return;
      }
      if (error.code === 'CONFLICT') {
        toast.error('This lead is not at the KYC stage.');
        return;
      }
      if (error.code === 'FORBIDDEN') {
        toast.error("You don't have access to run KYC for this lead.");
        return;
      }
    }
    toast.error('Could not run the KYC check. Please try again.');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>KYC checks</CardTitle>
        <CardDescription>Run identity verification for this lead.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {consentMissing ? <ConsentGateBanner /> : null}
        {hasException ? <KycExceptionBanner message={exceptionMessage ?? undefined} /> : null}

        <ul role="list">
          {CHECKS.map((check) => (
            <KycCheckRow
              key={check.type}
              label={check.label}
              enabled={check.enabled}
              requiresPan={check.requiresPan}
              result={results[check.type]}
              isPending={run.isPending && pendingType === check.type}
              canVerify={canVerify}
              onVerify={(panValue) => verify(check.type, panValue)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
