import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusChip } from '@/components/ui/StatusChip';
import { MaskedField } from '@/components/ui/MaskedField';
import { kycCheckStatusDisplay } from '@/components/kyc/status-display';
import type { KycVerificationData } from '@/types/kyc';

/**
 * FR-071 §UI — one KYC check row (status chip + action). PAN is MVP-enabled with
 * an inline PAN entry; the Phase-1.5 types render disabled with a hint. The masked
 * result (e.g. `ABCDE****F`) shows via {@link MaskedField}; raw values never reach
 * the client.
 */
export function KycCheckRow({
  label,
  enabled,
  requiresPan,
  result,
  isPending,
  canVerify,
  onVerify,
}: {
  label: string;
  enabled: boolean;
  requiresPan?: boolean;
  result?: KycVerificationData;
  isPending: boolean;
  canVerify: boolean;
  onVerify: (panValue?: string) => void;
}): JSX.Element {
  const [pan, setPan] = React.useState('');
  const display = result
    ? kycCheckStatusDisplay(result.status)
    : { label: 'Not started', tone: 'neutral' as const };
  const maskedPan =
    typeof result?.maskedResponse?.maskedPan === 'string' ? result.maskedResponse.maskedPan : null;

  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <StatusChip label={display.label} tone={display.tone} />
        <span className="text-sm font-medium">{label}</span>
        {maskedPan ? <MaskedField maskedValue={maskedPan} fieldType="pan" /> : null}
        {!enabled ? <span className="text-xs text-muted-foreground">(coming soon)</span> : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {enabled && requiresPan ? (
          <Input
            aria-label={`${label} number`}
            placeholder="ABCDE1234F"
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            className="h-9 w-36 uppercase"
            maxLength={10}
          />
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={!enabled || !canVerify || isPending || (requiresPan && pan.length === 0)}
          onClick={() => onVerify(requiresPan ? pan : undefined)}
        >
          {isPending ? 'Verifying…' : result ? 'Re-verify' : 'Verify'}
        </Button>
      </div>
    </li>
  );
}
