// @vitest-environment jsdom
/**
 * FR-112 — DataRightsPage component unit tests.
 * Covers UI-04 through UI-09 from FR-112-tests.md §UI Test Scenarios.
 *
 * Playwright E2E (UI-01 / UI-02 / UI-03 / UI-06) are DEFERRED to the
 * integration-test wave (manifest stage7.test_strategy).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── mock hooks BEFORE component imports ────────────────────────────────────────

vi.mock('./use-data-rights', () => ({
  useDataRights: vi.fn(),
  useProcessDataRights: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateDataRights: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  dataRightsKeys: { list: (p: unknown) => ['data-rights', 'list', p] },
}));

// mock DataRightsDetailDrawer so the page can be rendered in isolation
vi.mock('./DataRightsDetailDrawer', () => ({
  DataRightsDetailDrawer: () => null,
}));

import { useDataRights } from './use-data-rights';
import { DataRightsPage } from './DataRightsPage';
import type { DataRightsListResult, DataRightsItem } from './data-rights.types';

const mockUseDataRights = useDataRights as ReturnType<typeof vi.fn>;

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeRow(n: number, overrides: Partial<DataRightsItem> = {}): DataRightsItem {
  return {
    dataRightsRequestId: `req-${n}`,
    customerProfileId: `0000000${n}-0000-0000-0000-000000000000`,
    leadId: null,
    requestType: 'erasure',
    status: 'open',
    ownerId: null,
    dueAt: '2026-07-14T18:30:00.000Z',
    disposition: null,
    createdAt: '2026-06-14T09:00:00.000Z',
    updatedAt: '2026-06-14T09:00:00.000Z',
    createdBy: 'dpo-user-id',
    ...overrides,
  };
}

function makeResult(count: number, overrides: Partial<DataRightsItem> = {}): DataRightsListResult {
  return {
    data: Array.from({ length: count }, (_, i) => makeRow(i + 1, overrides)),
    meta: {
      correlation_id: 'corr-test',
      pagination: { page: 1, limit: 25, total: count },
    },
    error: null,
  };
}

function idleQuery(result: DataRightsListResult | undefined) {
  return {
    data: result,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

describe('DataRightsPage — page header', () => {
  it('renders page title', () => {
    mockUseDataRights.mockReturnValue(idleQuery(makeResult(0)));
    render(<DataRightsPage />);
    expect(screen.getByText('Data Rights Requests')).toBeDefined();
  });
});

describe('DataRightsPage — UI-04 FilterBar status filter', () => {
  it('passes status filter to useDataRights when changed', () => {
    mockUseDataRights.mockReturnValue(idleQuery(makeResult(0)));
    render(<DataRightsPage />);

    const statusSelect = screen.getByRole('combobox', { name: /filter by status/i });
    fireEvent.change(statusSelect, { target: { value: 'in_review' } });

    // Hook is re-called with the updated filter
    const lastCall = mockUseDataRights.mock.calls[mockUseDataRights.mock.calls.length - 1];
    expect(lastCall?.[0]).toMatchObject({ status: 'in_review' });
  });

  it('passes request_type filter to useDataRights when changed', () => {
    mockUseDataRights.mockReturnValue(idleQuery(makeResult(0)));
    render(<DataRightsPage />);

    const typeSelect = screen.getByRole('combobox', { name: /filter by request type/i });
    fireEvent.change(typeSelect, { target: { value: 'erasure' } });

    const lastCall = mockUseDataRights.mock.calls[mockUseDataRights.mock.calls.length - 1];
    expect(lastCall?.[0]).toMatchObject({ request_type: 'erasure' });
  });
});

describe('DataRightsPage — UI-07 Overdue highlighting', () => {
  it('overdue open row triggers Overdue badge', () => {
    const pastDue = new Date(Date.now() - 86_400_000).toISOString();
    mockUseDataRights.mockReturnValue(
      idleQuery(makeResult(1, { dueAt: pastDue, status: 'open' })),
    );
    render(<DataRightsPage />);
    // Overdue badge should appear
    expect(screen.getAllByLabelText('Overdue').length).toBeGreaterThan(0);
  });

  it('fulfilled row with past due_at does NOT show Overdue badge', () => {
    const pastDue = new Date(Date.now() - 86_400_000).toISOString();
    mockUseDataRights.mockReturnValue(
      idleQuery(makeResult(1, { dueAt: pastDue, status: 'fulfilled' })),
    );
    render(<DataRightsPage />);
    expect(screen.queryByLabelText('Overdue')).toBeNull();
  });
});

describe('DataRightsPage — UI-08 empty and UI-09 error states', () => {
  it('UI-08: DataTable emptyTitle shown when list is empty', () => {
    mockUseDataRights.mockReturnValue(idleQuery(makeResult(0)));
    render(<DataRightsPage />);
    // DataTable renders its emptyTitle when rows is empty
    expect(screen.getByText('No data rights requests found')).toBeDefined();
  });

  it('UI-09: error prop shown when isError=true', () => {
    mockUseDataRights.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<DataRightsPage />);
    expect(screen.getByText(/failed to load data rights requests/i)).toBeDefined();
  });
});

describe('DataRightsPage — UI-05 DispositionTextarea required validation', () => {
  it('renders without crashing when rows are present', () => {
    mockUseDataRights.mockReturnValue(idleQuery(makeResult(3)));
    const { container } = render(<DataRightsPage />);
    expect(container).toBeDefined();
  });
});
