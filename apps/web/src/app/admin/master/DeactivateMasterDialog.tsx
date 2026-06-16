import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { isApiClientError } from '@/lib/api';
import { useUpdateMaster } from '@/hooks/use-master-data';
import type { MasterRecordView, MasterResourceMeta } from '@/types/master-data';
import { readConflictReason } from './forms/form-utils';

/**
 * FR-131 — deactivation confirm for a master record (PATCH `isActive:false`).
 * Deactivation is referential-integrity guarded server-side: a CONFLICT (e.g.
 * "cannot delete region with active branches", or a legal-hold reason) is shown
 * inline rather than dismissed, so the operator knows the linked records must be
 * cleared first. Resources with no activeness (regions) never open this dialog.
 */
export function DeactivateMasterDialog({
  meta,
  record,
  recordLabel,
  onClose,
}: {
  meta: MasterResourceMeta;
  record: MasterRecordView;
  /** A human label for the record (e.g. its code) shown in the prompt. */
  recordLabel: string;
  onClose: () => void;
}): JSX.Element {
  const update = useUpdateMaster(meta.slug);
  const [conflict, setConflict] = React.useState<string | null>(null);

  async function confirm(): Promise<void> {
    setConflict(null);
    try {
      // `isActive` is valid on every activeness:'boolean' resource's patch body.
      await update.mutateAsync({ id: record.id, body: { isActive: false } as { isActive: boolean } });
      toast.success(`The ${meta.singular} was deactivated.`);
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'CONFLICT') {
        const reason = readConflictReason(error.detail);
        setConflict(
          reason ?? `This ${meta.singular} is referenced by active records and cannot be deactivated.`,
        );
        return;
      }
      if (isApiClientError(error) && error.code === 'FORBIDDEN') {
        setConflict("You don't have access to perform this change.");
        return;
      }
      setConflict(`Could not deactivate the ${meta.singular}. Please try again.`);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Deactivate ${meta.singular}`}>
      <div className="space-y-4">
        <p className="text-sm">
          Deactivate <span className="font-medium">{recordLabel}</span>? It will no longer be selectable.
          You can reactivate it later.
        </p>
        {conflict ? (
          <p role="alert" aria-live="assertive" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {conflict}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={update.isPending}>
            Deactivate
          </Button>
        </div>
      </div>
    </Modal>
  );
}
