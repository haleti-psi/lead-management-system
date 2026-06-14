// @vitest-environment jsdom
/**
 * FR-111 — SharingLogPage component unit tests.
 * Covers UI-01 through UI-04 from FR-111-tests.md §UI Test Scenarios.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── mock the hook (must come before any import of the module) ─────────────────

vi.mock('./useSharingLogs', () => ({
  useSharingLogs: vi.fn(),
  sharingLogKeys: { list: (p: unknown) => ['sharing-logs', 'list', p] },
}));

import { useSharingLogs } from './useSharingLogs';
import { SharingLogPage } from './SharingLogPage';
import type { SharingLogsResult } from './useSharingLogs';

const mockUseSharingLogs = useSharingLogs as ReturnType<typeof vi.fn>;

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeRow(n: number) {
  return {
    dataShareLogId: `log-${n}`,
    leadId: 'lead-001',
    recipient: `los-provider-${n}`,
    purpose: 'los_handoff',
    dataCategory: 'financial',
    consentId: `consent-${n}`,
    status: 'shared',
    sharedAt: '2026-06-09T10:30:00.000Z',
    createdAt: '2026-06-09T10:30:00.000Z',
  };
}

function makeResult(count: number): SharingLogsResult {
  return {
    data: Array.from({ length: count }, (_, i) => makeRow(i + 1)),
    meta: {
      correlation_id: 'corr-test',
      pagination: { page: 1, limit: 25, total: count },
    },
    error: null,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SharingLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── UI-01: renders log rows ────────────────────────────────────────────────

  it('UI-01: renders 2 table rows when API returns 2 sharing log rows', () => {
    mockUseSharingLogs.mockReturnValue({
      data: makeResult(2),
      isLoading: false,
      isError: false,
    });

    render(<SharingLogPage leadId="lead-001" />);

    // Each row renders "los_handoff" as the purpose and "financial" as the category.
    const purposeChips = screen.getAllByText(/los handoff/i);
    expect(purposeChips).toHaveLength(2);

    const recipientCells = screen.getAllByText(/los-provider/i);
    expect(recipientCells).toHaveLength(2);
  });

  // ── UI-02: empty state ────────────────────────────────────────────────────

  it('UI-02: renders EmptyState when API returns 0 rows', () => {
    mockUseSharingLogs.mockReturnValue({
      data: makeResult(0),
      isLoading: false,
      isError: false,
    });

    render(<SharingLogPage leadId="lead-001" />);

    expect(screen.getByText(/no sharing events/i)).toBeTruthy();
    // No table rows.
    expect(screen.queryByText(/los-provider/i)).toBeNull();
  });

  // ── UI-03: loading skeleton ───────────────────────────────────────────────

  it('UI-03: renders LoadingSkeleton while data is loading', () => {
    mockUseSharingLogs.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    const { container } = render(<SharingLogPage leadId="lead-001" />);

    // LoadingSkeleton renders something; table should NOT be present.
    expect(screen.queryByText(/los-provider/i)).toBeNull();
    // The container has child nodes (the skeleton rendered something).
    expect(container.firstChild).toBeTruthy();
  });

  // ── UI-04: error state ────────────────────────────────────────────────────

  it('UI-04: renders ErrorState when the API call fails', () => {
    mockUseSharingLogs.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<SharingLogPage leadId="lead-001" />);

    expect(screen.getByText(/unable to load data sharing log/i)).toBeTruthy();
    expect(screen.queryByText(/los-provider/i)).toBeNull();
  });
});
