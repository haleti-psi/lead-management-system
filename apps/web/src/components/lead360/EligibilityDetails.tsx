import type { EligibilitySnapshot } from './hooks/use-eligibility';

/** FR-080 — read-only eligibility detail rows (received state). */
export function EligibilityDetails({ snapshot }: { snapshot: EligibilitySnapshot }): JSX.Element {
  const validityLabel = snapshot.validityUntil
    ? new Date(snapshot.validityUntil).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' })
    : '—';

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <dt className="text-muted-foreground">Amount</dt>
      <dd className="font-medium">
        {snapshot.indicativeAmount
          ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(snapshot.indicativeAmount))
          : '—'}
      </dd>

      <dt className="text-muted-foreground">Tenure</dt>
      <dd className="font-medium">{snapshot.tenureMonths != null ? `${snapshot.tenureMonths} months` : '—'}</dd>

      <dt className="text-muted-foreground">Rate range</dt>
      <dd className="font-medium">{snapshot.rateRange ? `${snapshot.rateRange} % p.a.` : '—'}</dd>

      <dt className="text-muted-foreground">Valid until</dt>
      <dd className="font-medium">{validityLabel}</dd>

      {snapshot.conditions ? (
        <>
          <dt className="col-span-2 text-muted-foreground">Conditions</dt>
          <dd className="col-span-2">
            <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
              {Object.entries(snapshot.conditions).map(([k, v]) => (
                <li key={k}><span className="font-medium">{k}:</span> {String(v)}</li>
              ))}
            </ul>
          </dd>
        </>
      ) : null}
    </dl>
  );
}
