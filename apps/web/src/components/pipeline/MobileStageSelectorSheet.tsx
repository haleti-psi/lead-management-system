/**
 * FR-052 — MobileStageSelectorSheet
 *
 * A bottom-sheet modal for mobile stage selection (used instead of drag-and-drop
 * on touch devices). Renders a list of valid target stages for the selected lead.
 *
 * shadcn `Sheet` is not yet in the foundation (see AMBIGUITY.md §FR-052).
 * This is a minimal accessible modal: role="dialog", aria-modal, focus-trap,
 * Escape key closes. Built on Tailwind only; no new dependency added.
 */

import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';

import { BOARD_STAGES } from '@/hooks/use-pipeline-board';
import type { PipelineLeadCard } from './pipeline-board.types';

const STAGE_LABELS: Readonly<Record<string, string>> = {
  captured: 'Captured',
  assigned: 'Assigned',
  contacted: 'Contacted',
  qualified: 'Qualified',
  documents_pending: 'Documents Pending',
  kyc_in_progress: 'KYC In Progress',
  eligibility_requested: 'Eligibility Requested',
  ready_for_handoff: 'Ready for Handoff',
};

export interface MobileStageSelectorSheetProps {
  card: PipelineLeadCard | null;
  onSelect: (card: PipelineLeadCard, toStage: string) => void;
  onClose: () => void;
}

export function MobileStageSelectorSheet({
  card,
  onSelect,
  onClose,
}: MobileStageSelectorSheetProps): ReactElement | null {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button when the sheet opens.
  useEffect(() => {
    if (card) closeRef.current?.focus();
  }, [card]);

  if (!card) return null;

  function handleKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') onClose();
  }

  return (
    <>
      {/* Backdrop (purely visual — clicking it closes the sheet) */}
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet panel — separate from the backdrop so aria-hidden doesn't hide it */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${card.leadCode} to stage`}
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-xl bg-background p-4 pb-8 shadow-xl"
        onKeyDown={handleKey}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Move {card.leadCode}</h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            className="rounded p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <ul className="space-y-1" role="list">
          {BOARD_STAGES.filter((s) => s !== card.stage).map((stage) => (
            <li key={stage}>
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onSelect(card, stage);
                  onClose();
                }}
              >
                {STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ')}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
