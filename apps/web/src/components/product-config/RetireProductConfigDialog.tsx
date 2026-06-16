import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { isApiClientError } from '@/lib/api';
import { useRetireProductConfig } from '@/hooks/use-product-configs';
import type { ProductConfigListRow } from '@/types/product-config';

/**
 * FR-040 — retire an ACTIVE product configuration (PATCH `status:'retired'`).
 * Retiring blocks NEW leads from using this config; in-flight leads keep the
 * version they were pinned to, so this is non-destructive to existing work. A
 * server CONFLICT (e.g. the row is no longer active) is shown inline.
 */
export function RetireProductConfigDialog({
  config,
  onClose,
}: {
  config: ProductConfigListRow;
  onClose: () => void;
}): JSX.Element {
  const retire = useRetireProductConfig();
  const [conflict, setConflict] = React.useState<string | null>(null);

  async function confirm(): Promise<void> {
    setConflict(null);
    try {
      await retire.mutateAsync(config.product_config_id);
      toast.success('Configuration retired.');
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'CONFLICT') {
        setConflict('This configuration is no longer active and cannot be retired.');
        return;
      }
      if (isApiClientError(error) && error.code === 'FORBIDDEN') {
        setConflict("You don't have access to retire product configuration.");
        return;
      }
      setConflict('Could not retire the configuration. Please try again.');
    }
  }

  return (
    <Modal open onClose={onClose} title="Retire configuration">
      <div className="space-y-4">
        <p className="text-sm">
          Retire <span className="font-medium">{config.name}</span> (v{config.version})? New leads will no longer
          be able to use it. Leads already linked to this version are not affected.
        </p>
        {conflict ? (
          <p role="alert" aria-live="assertive" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {conflict}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={retire.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={retire.isPending}>
            Retire
          </Button>
        </div>
      </div>
    </Modal>
  );
}
