/**
 * FR-052 — KanbanColumn
 *
 * One stage column in the pipeline board. Renders a header (stage dot + name +
 * card-count badge), the list of LeadCards, and handles drag-over/drop so cards
 * can be dropped here from another column.
 *
 * States: loading (skeleton), error (ErrorState), empty (compact message),
 * success (list of LeadCards). All four states are covered per ui.md §States.
 */

import { useState, type DragEvent, type ReactElement } from 'react';

import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
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

/** Stage → semantic tone, mirroring the app-wide StatusChip colour mapping
 * (in-progress = blue, awaiting action = amber, ready = green). */
type StageTone = 'neutral' | 'progress' | 'warning' | 'positive';
const STAGE_TONE: Readonly<Record<string, StageTone>> = {
  captured: 'neutral',
  assigned: 'progress',
  contacted: 'progress',
  qualified: 'progress',
  documents_pending: 'warning',
  kyc_in_progress: 'progress',
  eligibility_requested: 'progress',
  ready_for_handoff: 'positive',
};
const TONE_DOT: Readonly<Record<StageTone, string>> = {
  neutral: 'bg-slate-400',
  progress: 'bg-blue-500',
  warning: 'bg-amber-500',
  positive: 'bg-emerald-500',
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
  const [isOver, setIsOver] = useState(false);

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = 'move';
    if (!isOver) setIsOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    // Only clear when the pointer truly leaves the column (not a child element).
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsOver(false);
    onDrop?.(e, stage);
  }

  const label = STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
  const tone = STAGE_TONE[stage] ?? 'neutral';

  return (
    <section
      aria-label={`${label} column`}
      className={cn(
        'flex w-[85vw] shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/40 transition-colors sm:w-64',
        isOver && 'border-primary/50 bg-primary/5 ring-2 ring-inset ring-primary/40',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <header className="flex items-center justify-between gap-2 border-b bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
          <span className="truncate text-sm font-semibold">{label}</span>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {total}
        </span>
      </header>

      {/* Column body */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2" data-testid={`column-${stage}`}>
        {isPending ? (
          <LoadingSkeleton rows={3} />
        ) : isError ? (
          <ErrorState title="Couldn't load column" message="Please try again." onRetry={onRetry} />
        ) : cards.length === 0 ? (
          <div className="flex h-full items-center justify-center px-2 py-8 text-center text-xs text-muted-foreground">
            No leads
          </div>
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
