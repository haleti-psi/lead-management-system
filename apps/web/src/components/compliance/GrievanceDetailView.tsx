/**
 * FR-114 — Read-only summary of a single grievance.
 * Renders all fields; description is free text (potentially PII — not exposed to
 * PARTNER scope; host is responsible for gate). Dates formatted as
 * "DD MMM YYYY HH:mm" (IST context is handled server-side).
 */

import { format, parseISO } from 'date-fns';
import type { GrievanceItem } from './grievance.types';
import { StatusChip } from '@/components/ui/StatusChip';

interface Props {
  grievance: GrievanceItem;
}

function Row({ label, value }: { label: string; value: string | null | undefined }): JSX.Element {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-2 text-sm">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words">{value ?? '—'}</dd>
    </div>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd MMM yyyy HH:mm');
  } catch {
    return iso;
  }
}

export function GrievanceDetailView({ grievance }: Props): JSX.Element {
  return (
    <dl className="divide-y divide-border">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-2 text-sm">
        <dt className="font-medium text-muted-foreground">Status</dt>
        <dd className="col-span-2">
          <StatusChip status={grievance.status} label="Grievance status" />
        </dd>
      </div>
      <Row label="Grievance no." value={grievance.grievanceNo} />
      <Row label="Source" value={grievance.source.replaceAll('_', ' ')} />
      <Row label="Category" value={grievance.category.replaceAll('_', ' ')} />
      <Row label="Description" value={grievance.description} />
      <Row label="Response" value={grievance.response} />
      <Row label="Closure proof" value={grievance.closureProofRef} />
      <Row label="SLA due" value={fmtDate(grievance.slaDueAt)} />
      <Row label="Created" value={fmtDate(grievance.createdAt)} />
      <Row label="Updated" value={fmtDate(grievance.updatedAt)} />
    </dl>
  );
}
