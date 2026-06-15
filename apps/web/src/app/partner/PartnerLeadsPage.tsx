import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { SubmitLeadForm } from '@/components/partner/SubmitLeadForm';
import { usePartnerLeads } from '@/hooks/use-partner-leads';
import type { PartnerLeadView } from '@/types/partner-lead';

const DUP_TONE: Readonly<Record<string, ChipTone>> = {
  none: 'neutral',
  flagged: 'warning',
  confirmed: 'danger',
};

/**
 * FR-091 §UI — Partner Console "My Leads" at `/partner/leads`. Lists the partner's
 * OWN submitted leads (masked, limited status) and opens a submit form. Server
 * enforces partner scope + masking; this view never receives raw PII or other
 * partners' data.
 */
export function PartnerLeadsPage(): JSX.Element {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [submitting, setSubmitting] = React.useState(false);

  const queryResult = usePartnerLeads({ page, limit });
  const result = queryResult.data;

  const columns: DataTableColumn<PartnerLeadView>[] = [
    { id: 'lead_code', header: 'Lead', cell: (l) => l.lead_code },
    { id: 'name_masked', header: 'Name', cell: (l) => l.name_masked },
    { id: 'mobile_masked', header: 'Mobile', cell: (l) => l.mobile_masked },
    { id: 'product_code', header: 'Product', cell: (l) => l.product_code },
    { id: 'stage', header: 'Stage', cell: (l) => <StatusChip label={l.stage} tone="info" /> },
    {
      id: 'duplicate_status',
      header: 'Duplicate',
      cell: (l) => <StatusChip label={l.duplicate_status} tone={DUP_TONE[l.duplicate_status] ?? 'neutral'} />,
    },
    { id: 'created_at', header: 'Submitted', cell: (l) => new Date(l.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">My Leads</h1>
        <Button onClick={() => setSubmitting(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Submit lead
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(l) => l.lead_id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => { setLimit(l); setPage(1); }}
        isLoading={queryResult.isLoading}
        error={queryResult.isError ? 'Could not load your leads.' : null}
        onRetry={() => void queryResult.refetch()}
        emptyTitle="No leads yet"
        emptyMessage="Submit your first lead to get started."
      />

      <Modal open={submitting} onClose={() => setSubmitting(false)} title="Submit a lead">
        <SubmitLeadForm onClose={() => setSubmitting(false)} />
      </Modal>
    </div>
  );
}
