import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/StatusChip';
import type { PartnerView } from '@/types/partner';
import { STATUS_TONE } from './partner-status';

/** A labelled read-only detail row. Renders an em dash for empty values. */
function Field({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </div>
  );
}

/**
 * FR-090 §UI — read-only partner detail. Shows the full master record (mobile
 * already masked by the API) and a link to the partner's quality dashboard at
 * `/partner/:id/quality` (FR-092). Edit / status changes happen from the list row
 * actions, not here, so this stays a non-mutating view.
 */
export function PartnerDetailDialog({
  partner,
  onClose,
}: {
  partner: PartnerView;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal open onClose={onClose} title={partner.legalName}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {partner.partnerCode} · {partner.type}
          </span>
          <StatusChip label={partner.status} tone={STATUS_TONE[partner.status] ?? 'neutral'} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Contact person" value={partner.contactPerson} />
          <Field label="Contact mobile" value={partner.contactMobile} />
          <Field
            label="Products"
            value={partner.products.length > 0 ? partner.products.join(', ') : null}
          />
          <Field label="Risk category" value={partner.riskCategory} />
          <Field label="Quality score" value={partner.qualityScore} />
          <Field label="Commission" value={partner.commissionFlag ? 'Yes' : 'No'} />
          <Field label="Agreement reference" value={partner.agreementRef} />
          <Field label="Valid until" value={partner.validUntil} />
          <Field
            label="Created"
            value={new Date(partner.createdAt).toLocaleDateString()}
          />
          <Field
            label="Updated"
            value={new Date(partner.updatedAt).toLocaleDateString()}
          />
        </dl>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button asChild>
            <Link to={`/partner/${partner.partnerId}/quality`}>View quality</Link>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
