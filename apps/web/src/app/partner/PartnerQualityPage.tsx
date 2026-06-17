import { Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { isApiClientError } from '@/lib/api';
import { usePartnerQuality } from '@/hooks/use-partner-quality';
import type { PartnerQualityData } from '@/types/partner-quality';

const FACTOR_LABELS: ReadonlyArray<{ key: keyof PartnerQualityData['factors']; label: string }> = [
  { key: 'contactability_index', label: 'Contactability' },
  { key: 'handoff_index', label: 'Hand-off' },
  { key: 'document_quality_index', label: 'Document quality' },
  { key: 'speed_index', label: 'Speed' },
  { key: 'duplicate_penalty', label: 'Duplicate penalty' },
  { key: 'rejection_penalty', label: 'Rejection penalty' },
];

function scoreBand(score: number): { tone: ChipTone; label: string } {
  if (score >= 70) return { tone: 'success', label: 'Good' };
  if (score >= 40) return { tone: 'warning', label: 'Fair' };
  return { tone: 'danger', label: 'Needs attention' };
}

const fmt = (v: number | null): string => (v == null ? '–' : `${v}%`);

/**
 * FR-092 §UI — Partner Quality dashboard at `/partner/:id/quality`. Score card
 * (banded), factor breakdown, and a metrics grid. Null factors render "–" (zero
 * denominator); `insufficient_data` shows a banner instead of a score.
 */
export function PartnerQualityPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = usePartnerQuality(id ?? '');

  if (!id) return <Navigate to="/" replace />;

  if (isLoading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (isError || !data) {
    const code = isApiClientError(error) ? error.code : undefined;
    const message =
      code === 'FORBIDDEN'
        ? "You don't have access to this partner's quality score."
        : code === 'NOT_FOUND'
          ? 'Partner not found.'
          : 'Could not load the quality score.';
    return <ErrorState title="Quality score unavailable" message={message} onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Partner Quality"
        description={`${data.legal_name} · ${data.partner_code} · ${data.window.from} → ${data.window.to}`}
      />

      {data.insufficient_data ? (
        <EmptyState title="Not enough data" message="Not enough lead data to compute a quality score yet." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Quality score</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <span className="text-4xl font-semibold tabular-nums">{data.quality_score ?? '–'}</span>
            {data.quality_score != null ? (
              <StatusChip {...scoreBand(data.quality_score)} />
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Factor breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm" aria-label="Quality factor breakdown">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 font-medium">Factor</th>
                <th className="py-1.5 font-medium">Weight</th>
                <th className="py-1.5 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {FACTOR_LABELS.map(({ key, label }) => (
                <tr key={key} className="border-b last:border-b-0">
                  <td className="py-1.5">{label}</td>
                  <td className="py-1.5 tabular-nums">{data.factor_weights[key]}</td>
                  <td className="py-1.5 tabular-nums">{fmt(data.factors[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metrics</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Total leads" value={data.metrics.total_leads} />
          <Metric label="Contactable" value={data.metrics.contactable_leads} />
          <Metric label="Handed off" value={data.metrics.handed_off_leads} />
          <Metric label="Rejected" value={data.metrics.rejected_leads} />
          <Metric label="Duplicates" value={data.metrics.duplicate_leads} />
          <Metric label="Docs uploaded" value={data.metrics.uploaded_docs} />
          <Metric label="Verified (1st)" value={data.metrics.verified_docs_first_time} />
          <Metric label="KYC mismatch" value={data.metrics.kyc_mismatch_leads} />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
