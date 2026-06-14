import { DocStatus } from '@lms/shared';
import { StatusChip } from '@/components/ui/StatusChip';
import { UploadDocumentDialog } from '@/components/kyc/UploadDocumentDialog';
import { WaiverModal } from '@/components/kyc/WaiverModal';
import { docStatusDisplay } from '@/components/kyc/status-display';
import type { ChecklistItem as ChecklistItemModel } from '@/types/documents';

/** Terminal statuses for which a (re)upload makes no sense (LLD §UI). */
const UPLOAD_HIDDEN_STATUSES: ReadonlySet<DocStatus> = new Set([DocStatus.VERIFIED, DocStatus.WAIVED]);

/**
 * One checklist row (LLD §UI — ChecklistItem): status chip, label, mandatory
 * marker, version, and the role-gated upload / waive affordances. There is no
 * "View" action — the document binary is never exposed to the client
 * (`storage_ref` is server-only), and this FR contracts no download endpoint.
 */
export function ChecklistItem({
  item,
  leadId,
  canUpload,
  canWaive,
}: {
  item: ChecklistItemModel;
  leadId: string;
  canUpload: boolean;
  canWaive: boolean;
}): JSX.Element {
  const display = docStatusDisplay(item.status);
  const showUpload = canUpload && !UPLOAD_HIDDEN_STATUSES.has(item.status);
  const showWaive = canWaive && item.status !== DocStatus.WAIVED && Boolean(item.document_id);

  return (
    <li className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusChip label={display.label} tone={display.tone} />
        <span className="truncate text-sm font-medium">{item.label}</span>
        {item.mandatory ? (
          <span className="text-destructive" aria-label="Mandatory">
            *
          </span>
        ) : null}
        {item.version && item.version > 1 ? (
          <span className="text-xs text-muted-foreground">v{item.version}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {showUpload ? <UploadDocumentDialog item={item} target={{ kind: 'staff', leadId }} /> : null}
        {showWaive ? <WaiverModal item={item} leadId={leadId} /> : null}
      </div>
    </li>
  );
}
