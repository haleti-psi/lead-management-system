/**
 * FR-114 — Slide-in drawer for grievance detail + resolution form.
 * Implemented as a fixed right-panel (shadcn Drawer not yet installed;
 * uses Tailwind directly). On mobile the panel takes full width.
 * Hosts GrievanceDetailView (read-only fields) and GrievanceResolutionForm.
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { GrievanceDetailView } from './GrievanceDetailView';
import { GrievanceResolutionForm } from './GrievanceResolutionForm';
import type { GrievanceItem, UpdateGrievanceInput } from './grievance.types';

interface GrievanceDrawerProps {
  /** `null` → drawer is closed. */
  grievance: GrievanceItem | null;
  /** Called when the drawer should close (row deselected, Escape key, X button). */
  onClose: () => void;
  /** Mutation callback; throws on error so EntityForm can surface it. */
  onUpdate: (id: string, input: UpdateGrievanceInput) => Promise<void>;
}

export function GrievanceDrawer({ grievance, onClose, onUpdate }: GrievanceDrawerProps): JSX.Element {
  // Close on Escape
  useEffect(() => {
    if (!grievance) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [grievance, onClose]);

  if (!grievance) return <></>;

  async function handleUpdate(input: UpdateGrievanceInput): Promise<void> {
    await onUpdate(grievance!.grievanceId, input);
    toast.success('Grievance updated.');
    onClose();
  }

  function handleError(error: unknown): void {
    // Surface non-VALIDATION_ERROR errors as a toast (per ui.md §Toast feedback).
    const msg = error instanceof Error ? error.message : 'Something went wrong.';
    toast.error(msg);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        aria-label="Grievance detail"
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-background shadow-2xl sm:max-w-md"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Grievance
            </p>
            <h2 className="font-semibold">{grievance.grievanceNo}</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close drawer"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <section aria-labelledby="detail-heading">
            <h3 id="detail-heading" className="mb-2 text-sm font-semibold">
              Details
            </h3>
            <GrievanceDetailView grievance={grievance} />
          </section>

          <section aria-labelledby="resolution-heading">
            <h3 id="resolution-heading" className="mb-2 text-sm font-semibold">
              Update
            </h3>
            <GrievanceResolutionForm
              grievance={grievance}
              onSubmit={handleUpdate}
              onError={handleError}
            />
          </section>
        </div>
      </aside>
    </>
  );
}
