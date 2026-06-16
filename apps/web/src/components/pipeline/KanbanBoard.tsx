/**
 * FR-052 — KanbanBoard
 *
 * Multi-column Kanban board rendered from the pipeline board data. Desktop:
 * horizontally-scrollable column grid. Mobile: vertical list of columns with
 * "Move stage" button on each card opening MobileStageSelectorSheet.
 *
 * Drag-and-drop:
 *   1. DragStart stores { leadId, version, fromStage } in dataTransfer.
 *   2. Drop on a column calls `useTransitionStage.transition` with the new stage.
 *   3. On guard failure / CONFLICT → toast + snap-back (no optimistic update
 *      is applied here; the card stays in its original column until the queries
 *      are refetched via the React Query cache invalidation on success).
 *
 * The board reloads all columns on a successful transition via
 * `queryClient.invalidateQueries(['pipeline-board'])`.
 */

import { useState, type DragEvent, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { usePipelineBoard, BOARD_STAGES } from '@/hooks/use-pipeline-board';
import { useTransitionStage } from '@/hooks/use-transition-stage';
import { KanbanColumn } from './KanbanColumn';
import { MobileStageSelectorSheet } from './MobileStageSelectorSheet';
import type { PipelineLeadCard } from './pipeline-board.types';

/** Payload stored in drag dataTransfer. */
interface DragPayload {
  leadId: string;
  version: number;
  fromStage: string;
}

function encodeDrag(payload: DragPayload): string {
  return JSON.stringify(payload);
}

function decodeDrag(raw: string): DragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'leadId' in parsed &&
      'version' in parsed &&
      'fromStage' in parsed
    ) {
      return parsed as DragPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function KanbanBoard(): ReactElement {
  const board = usePipelineBoard();
  const queryClient = useQueryClient();
  const [mobileCard, setMobileCard] = useState<PipelineLeadCard | null>(null);

  const { transition } = useTransitionStage({
    onSuccess: () => {
      // Invalidate all board column queries so every column reloads.
      void queryClient.invalidateQueries({ queryKey: ['pipeline-board'] });
    },
    onSnapBack: () => {
      // No optimistic update applied, so snap-back is a no-op here.
      // The board state is unchanged; the toast already explains the failure.
    },
  });

  function handleDragStart(e: DragEvent<HTMLDivElement>, card: PipelineLeadCard): void {
    e.dataTransfer.setData(
      'text/plain',
      encodeDrag({ leadId: card.leadId, version: card.version, fromStage: card.stage }),
    );
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, toStage: string): void {
    const raw = e.dataTransfer.getData('text/plain');
    const payload = decodeDrag(raw);
    if (!payload || payload.fromStage === toStage) return;

    void transition(payload.leadId, {
      to: toStage,
      expected_version: payload.version,
    });
  }

  function handleMobileSelect(card: PipelineLeadCard, toStage: string): void {
    void transition(card.leadId, { to: toStage, expected_version: card.version });
  }

  const anyPending = BOARD_STAGES.some((stage) => board[stage].isPending);
  const totalLeads = BOARD_STAGES.reduce((sum, stage) => sum + board[stage].total, 0);

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Pipeline Board</h1>
          {!anyPending && totalLeads > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {totalLeads}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag a card between columns to move a lead through your pipeline.
        </p>
      </div>

      {/* Desktop: horizontal scroll; mobile: vertical stack */}
      <div
        className="flex-1 overflow-x-auto"
        role="region"
        aria-label="Pipeline board"
        data-testid="kanban-board"
      >
        <div className="flex gap-4 pb-4 min-w-max md:min-w-0">
          {BOARD_STAGES.map((stage) => {
            const col = board[stage];
            return (
              <KanbanColumn
                key={stage}
                stage={stage}
                cards={col.cards}
                total={col.total}
                isPending={col.isPending}
                isError={col.isError}
                onRetry={col.refetch}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                onMoveClick={(card) => setMobileCard(card)}
              />
            );
          })}
        </div>
      </div>

      {/* Mobile stage selector */}
      <MobileStageSelectorSheet
        card={mobileCard}
        onSelect={handleMobileSelect}
        onClose={() => setMobileCard(null)}
      />
    </div>
  );
}
