import * as React from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { EntityForm, FormField, FormTextarea } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useWaiveDocument } from '@/hooks/use-waive-document';
import type { ChecklistItem, WaiverBody } from '@/types/documents';

/** Client-side mirror of the server WaiverDto (LLD §Validation — WaiverDto). The
 * server remains authoritative; this gives instant inline feedback. Empty
 * optional fields are normalised to `undefined` before the request is built. */
const waiverSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Waiver reason is required (10–500 characters).')
    .max(500, 'Waiver reason is required (10–500 characters).'),
  expires_at: z.string().optional(),
  review_note: z.string().trim().max(500, 'Review note must be 500 characters or fewer.').optional(),
});
type WaiverFormValues = z.infer<typeof waiverSchema>;

/** Tomorrow as `YYYY-MM-DD` for the date input's `min` (LLD: expiry ≥ today + 1). */
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Waiver affordance for one checklist item (LLD §UI — WaiverModal). Rendered only
 * for users with `verify_doc` (KYC/BM); the server re-checks. Audited action, so
 * a reason is mandatory.
 */
export function WaiverModal({
  item,
  leadId,
}: {
  item: ChecklistItem;
  leadId: string;
}): JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  const waive = useWaiveDocument(leadId);

  if (!item.document_id) return null;
  const documentId = item.document_id;

  async function onSubmit(values: WaiverFormValues): Promise<void> {
    const body: WaiverBody = {
      reason: values.reason.trim(),
      ...(values.expires_at ? { expires_at: values.expires_at } : {}),
      ...(values.review_note?.trim() ? { review_note: values.review_note.trim() } : {}),
    };
    await waive.mutateAsync({ documentId, body });
    toast.success(`${item.label} waived.`);
    setOpen(false);
  }

  function onError(error: unknown): void {
    if (isApiClientError(error) && error.code === 'FORBIDDEN') {
      toast.error("You don't have access to waive this document.");
      return;
    }
    if (isApiClientError(error) && error.code === 'CONFLICT') {
      toast.error('This document is already waived.');
      return;
    }
    toast.error('Could not waive the document. Please try again.');
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Waive
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Waive ${item.label}`}
        description="Recorded as an audited exception. A reason is required."
      >
        <EntityForm
          schema={waiverSchema}
          defaultValues={{ reason: '', expires_at: '', review_note: '' }}
          onSubmit={onSubmit}
          onError={onError}
          submitLabel="Confirm waiver"
        >
          <FormTextarea name="reason" label="Waiver reason" required rows={3} maxLength={500} />
          <FormField name="expires_at" label="Expires on" type="date" min={tomorrowIso()} />
          <FormTextarea name="review_note" label="Review note" rows={2} maxLength={500} />
        </EntityForm>
      </Modal>
    </>
  );
}
