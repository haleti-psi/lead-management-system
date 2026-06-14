/**
 * FR-052 — KanbanColumn
 *
 * One stage column in the pipeline board. Renders a header (stage name + card
 * count), the list of LeadCards, and handles drag-over/drop so cards can be
 * dropped here from another column.
 *
 * States: loading (skeleton), error (ErrorState), empty (EmptyState), success
 * (list of LeadCards). All four states are covered per ui.md §States.
 */

import type { DragEvent, ReactElement } from 'react';

import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { cn } from '@/lib/utils';
import { LeadCard } from './LeadCard';
import type { PipelineLeadCard } from './pipeline-board.types';

/** Maps a stage key to a human-readable column title. */
const STAGE_LABELS: Readonly<Record<string, string>> = {
  captured: 'Captured',
  assigned: 'Assigned',
  contacted: 'Contacted',
  qualified: 'Qualified',
  documents_pending: 'Documents',
  kyc_in_progress: 'KYC',
  eligibility_requested: 'Eligibility',
  ready_for_handoff: 'Ready',
};

export interface KanbanColumnProps {
  stage: string;
  cards: PipelineLeadCard[];
  total: number;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onDragStart?: (e: DragEvent<HTMLDivElement>, card: PipelineLeadCard) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, toStage: string) => void;
  onMoveClick?: (card: PipelineLeadCard) => void;
}

export function KanbanColumn({
  stage,
  cards,
  total,
  isPending,
  isError,
  onRetry,
  onDragStart,
  onDrop,
  onMoveClick,
}: KanbanColumnProps): ReactElement {
  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    onDrop?.(e, stage);
  }

  const label = STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');

  return (
    <section
      aria-label={`${label} column`}
      className={cn(
        'flex flex-col w-64 shrink-0 rounded-lg bg-muted/40 border',
        'overflow-hidden',
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <header className="flex items-center justify-between px-3 py-2 border-b bg-card">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{total}</span>
      </header>

      {/* Column body */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2" data-testid={`column-${stage}`}>
        {isPending ? (
          <LoadingSkeleton rows={3} />
        ) : isError ? (
          <ErrorState
            title="Couldn't load column"
            message="Please try again."
            onRetry={onRetry}
          />
        ) : cards.length === 0 ? (
          <EmptyState title="No leads" message={`No leads in ${label}.`} />
        ) : (
          cards.map((card) => (
            <LeadCard
              key={card.leadId}
              card={card}
              onDragStart={onDragStart}
              onMoveClick={onMoveClick}
            />
          ))
        )}
      </div>
    </section>
  );
}
