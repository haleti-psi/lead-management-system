// @vitest-environment jsdom
//
// FR-052 §UI tests for the pipeline board components.
// The usePipelineBoard hook and useTransitionStage hook are mocked so
// components run in isolation without a network or server.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── mock hooks (declared before module import) ─────────────────────────────
vi.mock('@/hooks/use-pipeline-board', () => ({
  usePipelineBoard: vi.fn(),
  BOARD_STAGES: [
    'captured',
    'assigned',
    'contacted',
    'qualified',
    'documents_pending',
    'kyc_in_progress',
    'eligibility_requested',
    'ready_for_handoff',
  ],
}));

vi.mock('@/hooks/use-transition-stage', () => ({
  useTransitionStage: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  };
});

import { usePipelineBoard } from '@/hooks/use-pipeline-board';
import { useTransitionStage } from '@/hooks/use-transition-stage';
import { KanbanBoard } from './KanbanBoard';
import type { PipelineLeadCard } from './pipeline-board.types';
import type { PipelineBoard, BoardStage } from '@/hooks/use-pipeline-board';

const mockUsePipelineBoard = usePipelineBoard as ReturnType<typeof vi.fn>;
const mockUseTransitionStage = useTransitionStage as ReturnType<typeof vi.fn>;

function makeCard(overrides: Partial<PipelineLeadCard> = {}): PipelineLeadCard {
  return {
    leadId: 'aaaaaaaa-0000-4000-8000-000000000001',
    leadCode: 'LD-2026-000001',
    customerName: 'Ra***** K****',
    productCode: 'CV',
    requestedAmount: '500000',
    stage: 'assigned',
    isHot: false,
    consentStatus: 'captured',
    kycStatus: 'not_started',
    ownerName: 'Anita Sharma',
    ageingDays: 3,
    nextActionAt: null,
    version: 2,
    ...overrides,
  };
}

type ColState = PipelineBoard[BoardStage];
function makeColState(overrides: Partial<ColState> = {}): ColState {
  return {
    cards: [],
    total: 0,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeEmptyBoard(): PipelineBoard {
  return {
    captured: makeColState(),
    assigned: makeColState(),
    contacted: makeColState(),
    qualified: makeColState(),
    documents_pending: makeColState(),
    kyc_in_progress: makeColState(),
    eligibility_requested: makeColState(),
    ready_for_handoff: makeColState(),
  };
}

beforeEach(() => {
  mockUseTransitionStage.mockReturnValue({
    transition: vi.fn(),
    isTransitioning: false,
  });
});

// ── UI-052-01: loading state (at least one column pending) ─────────────────

describe('KanbanBoard — loading state', () => {
  it('renders a loading skeleton when a column is pending', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({ isPending: true });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);

    // The loading skeleton renders rows.
    const skeleton = document.querySelector('[data-testid="column-assigned"]');
    expect(skeleton).toBeTruthy();
  });
});

// ── UI-052-02: empty state ─────────────────────────────────────────────────

describe('KanbanBoard — empty state', () => {
  it('shows "No leads" for columns with zero cards', () => {
    mockUsePipelineBoard.mockReturnValue(makeEmptyBoard());
    render(<KanbanBoard />);
    const emptyMessages = screen.getAllByText(/no leads/i);
    expect(emptyMessages.length).toBeGreaterThan(0);
  });
});

// ── UI-052-03: error state ─────────────────────────────────────────────────

describe('KanbanBoard — error state', () => {
  it('renders an error state and retry button when a column errors', () => {
    const board = makeEmptyBoard();
    const retryFn = vi.fn();
    board.captured = makeColState({ isError: true, refetch: retryFn });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    expect(screen.getByText(/couldn't load column/i)).toBeTruthy();
    const retryBtn = screen.getByRole('button', { name: /try again/i });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    expect(retryFn).toHaveBeenCalledOnce();
  });
});

// ── UI-052-04: success state — cards render ─────────────────────────────────

describe('KanbanBoard — success state', () => {
  it('renders lead cards when data is loaded', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard({ leadCode: 'LD-2026-000042', customerName: 'Ra***** K****' })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    expect(screen.getByText('LD-2026-000042')).toBeTruthy();
    expect(screen.getByText('Ra***** K****')).toBeTruthy();
  });

  it('renders hot flag flame for hot leads', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard({ isHot: true })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    const flame = document.querySelector('[aria-label="Hot lead"]');
    expect(flame).toBeTruthy();
  });

  it('does not render hot flag for non-hot leads', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard({ isHot: false })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    const flame = document.querySelector('[aria-label="Hot lead"]');
    expect(flame).toBeNull();
  });

  it('renders StatusChips for consent and KYC', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard({ consentStatus: 'captured', kycStatus: 'verified' })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    const chips = document.querySelectorAll('[data-status]');
    const statuses = Array.from(chips).map((c) => c.getAttribute('data-status'));
    expect(statuses).toContain('captured');
    expect(statuses).toContain('verified');
  });

  it('shows ageing in days', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard({ ageingDays: 7 })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    expect(screen.getByText('7d')).toBeTruthy();
  });

  it('shows owner name', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard({ ownerName: 'Priya Singh' })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    expect(screen.getByText('Priya Singh')).toBeTruthy();
  });

  it('shows "Unassigned" for null owner', () => {
    const board = makeEmptyBoard();
    board.captured = makeColState({
      cards: [makeCard({ ownerName: null, stage: 'captured' })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });
});

// ── UI-052-05: mobile stage selector ──────────────────────────────────────

describe('KanbanBoard — mobile stage selector', () => {
  it('opens mobile sheet when "Move stage" button is clicked', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard({ leadCode: 'LD-TEST-001' })],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    const moveBtn = screen.getByRole('button', { name: /move stage/i });
    fireEvent.click(moveBtn);
    // Sheet should now be open
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/move LD-TEST-001/i)).toBeTruthy();
  });

  it('closes mobile sheet when close button is clicked', () => {
    const board = makeEmptyBoard();
    board.assigned = makeColState({
      cards: [makeCard()],
      total: 1,
    });
    mockUsePipelineBoard.mockReturnValue(board);

    render(<KanbanBoard />);
    fireEvent.click(screen.getByRole('button', { name: /move stage/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
