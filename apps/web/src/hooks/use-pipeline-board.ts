/**
 * FR-052 — usePipelineBoard hook.
 *
 * Loads each Kanban column from `GET /api/v1/pipeline-board?stage=<stage>` — the
 * masked, scope-filtered board projection (carries amount / owner / ageing /
 * version). Each stage is an independent react-query so a single column error
 * doesn't block the others and columns refetch individually after a transition.
 */

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api';
import type { BoardLeadRow, PipelineLeadCard } from '@/components/pipeline/pipeline-board.types';

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

/** Map a `GET /pipeline-board` row (snake_case, masked) to a board card. */
export function toCard(row: BoardLeadRow): PipelineLeadCard {
  return {
    leadId: row.lead_id,
    leadCode: row.lead_code,
    customerName: row.name_masked ?? '—',
    productCode: row.product_code,
    stage: row.stage,
    isHot: row.is_hot,
    consentStatus: row.consent_status,
    kycStatus: row.kyc_status,
    score: row.score,
    requestedAmount: row.requested_amount,
    ownerName: row.owner_name,
    ageingDays: row.ageing_days,
    version: row.version,
  };
}

export interface BoardColumnState {
  cards: PipelineLeadCard[];
  total: number;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

function useBoardColumn(stage: BoardStage, pageLimit = 25): BoardColumnState {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['pipeline-board', stage],
    queryFn: async () => {
      const page = await apiClient.getPage<BoardLeadRow>('/pipeline-board', {
        query: { stage, limit: pageLimit, page: 1 },
      });
      return {
        cards: page.data.map(toCard),
        total: page.pagination?.total ?? page.data.length,
      };
    },
    staleTime: 30_000,
  });

  return {
    cards: data?.cards ?? [],
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
