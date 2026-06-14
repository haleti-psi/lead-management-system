/**
 * FR-052 — usePipelineBoard hook.
 *
 * Loads all Kanban columns in parallel by calling `GET /api/v1/leads` once per
 * stage (with `filter[stage]=<stage>`). Uses @tanstack/react-query so each
 * column has its own cache key and can be individually refetched after a
 * stage transition.
 *
 * The hook returns a map of stage → { data, isPending, isError }. Callers
 * (KanbanBoard) render per-column states independently.
 */

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api';
import type { LeadListData, PipelineLeadCard } from '@/components/pipeline/pipeline-board.types';

/** The ordered list of stages shown on the board (left-to-right). */
export const BOARD_STAGES = [
  'captured',
  'assigned',
  'contacted',
  'qualified',
  'documents_pending',
  'kyc_in_progress',
  'eligibility_requested',
  'ready_for_handoff',
] as const;

export type BoardStage = typeof BOARD_STAGES[number];

export interface BoardColumnState {
  cards: PipelineLeadCard[];
  total: number;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

function useBoardColumn(stage: BoardStage, pageLimit = 25): BoardColumnState {
  const { data, isPending, isError, refetch } = useQuery<LeadListData>({
    queryKey: ['pipeline-board', stage],
    queryFn: () =>
      apiClient.get<LeadListData>('/leads', {
        query: { 'filter[stage]': stage, limit: pageLimit, page: 1 },
      }),
    staleTime: 30_000,
  });

  return {
    cards: data?.items ?? [],
    total: data?.total ?? 0,
    isPending,
    isError,
    refetch: () => {
      void refetch();
    },
  };
}

export type PipelineBoard = Record<BoardStage, BoardColumnState>;

/**
 * Load all board columns. Each stage is an independent query so a single column
 * error does not block the others. The returned object is stable across renders
 * as long as none of the column queries change state.
 */
export function usePipelineBoard(): PipelineBoard {
  // Rules-of-hooks: call one hook per stage in fixed order (BOARD_STAGES is const).
  const captured = useBoardColumn('captured');
  const assigned = useBoardColumn('assigned');
  const contacted = useBoardColumn('contacted');
  const qualified = useBoardColumn('qualified');
  const documents_pending = useBoardColumn('documents_pending');
  const kyc_in_progress = useBoardColumn('kyc_in_progress');
  const eligibility_requested = useBoardColumn('eligibility_requested');
  const ready_for_handoff = useBoardColumn('ready_for_handoff');

  return {
    captured,
    assigned,
    contacted,
    qualified,
    documents_pending,
    kyc_in_progress,
    eligibility_requested,
    ready_for_handoff,
  };
}
