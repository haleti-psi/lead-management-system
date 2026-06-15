// @vitest-environment jsdom
//
// FR-082 §UI tests (T16, T17, U01–U05) for LosStatusPanel and LosStatusTimeline.
// React Query and apiClient are mocked so components run without a network.
//
// Uses only built-in Vitest matchers (no @testing-library/jest-dom) per project
// convention — see SearchPalette.test.tsx and DlaRegistryDrawer.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

// ── mock apiClient ────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
  },
  isApiClientError: (err: unknown) =>
    typeof err === 'object' && err !== null && 'status' in err,
}));

import { apiClient } from '@/lib/api';
import { LosStatusPanel, formatStatusDate } from './LosStatusPanel';
import { LosStatusTimeline } from './LosStatusTimeline';
import type { LosStatusEntry } from './los-status.types';

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;

// ── test factories ────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LosStatusEntry> = {}): LosStatusEntry {
  return {
    losMirrorId: 'mir-001',
    leadId: 'lead-001',
    losApplicationId: 'LOS-2026-00123',
    status: 'CREDIT_APPRAISAL',
    statusDate: '2026-06-09T10:30:00Z',
    receivedVia: 'webhook',
    correlationId: 'corr_xyz',
    createdAt: '2026-06-09T10:30:00Z',
    ...overrides,
  };
}

/** Wrap a component with a fresh QueryClient. */
function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderInWrapper(ui: ReactNode) {
  return render(ui, { wrapper: Wrapper });
}

// ── formatStatusDate unit tests ───────────────────────────────────────────────

describe('formatStatusDate', () => {
  // U03 — status_date displayed in IST format (dd-MM-yyyy HH:mm)
  it('formats 2026-06-09T10:30:00Z as 09-06-2026 16:00 IST (U03)', () => {
    expect(formatStatusDate('2026-06-09T10:30:00Z')).toBe('09-06-2026 16:00');
  });
});

// ── LosStatusPanel tests ─────────────────────────────────────────────────────

describe('LosStatusPanel', () => {
  const LEAD_ID = 'lead-001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // U04 — LoadingSkeleton while query is in-flight
  it('renders LoadingSkeleton while query is loading (U04)', () => {
    // Return a never-resolving promise so the component stays in loading state.
    mockGet.mockReturnValue(new Promise(() => undefined));

    renderInWrapper(<LosStatusPanel leadId={LEAD_ID} />);

    // LoadingSkeleton renders role="status" with aria-label="Loading".
    const statusEl = screen.getByRole('status', { name: /loading/i });
    expect(statusEl).toBeDefined();
  });

  // T17 — EmptyState when no mirror exists
  it('renders EmptyState with "No LOS application linked" when API returns [] (T17)', async () => {
    mockGet.mockResolvedValue([]);

    renderInWrapper(<LosStatusPanel leadId={LEAD_ID} />);

    // Wait for the query to resolve.
    const emptyEl = await screen.findByText('No LOS application linked');
    expect(emptyEl).toBeDefined();
  });

  // U05 — ErrorState when API returns an error
  it('renders ErrorState with "Something went wrong" on query failure (U05)', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));

    renderInWrapper(<LosStatusPanel leadId={LEAD_ID} />);

    const errorEl = await screen.findByText('Something went wrong');
    expect(errorEl).toBeDefined();
  });

  // T16 — renders mirror data for authorized user
  it('renders status, date (IST), received_via, Application ID, badge (T16)', async () => {
    const entry = makeEntry({
      status: 'CREDIT_APPRAISAL',
      statusDate: '2026-06-09T10:30:00Z',
      receivedVia: 'webhook',
      correlationId: 'corr_xyz',
      losApplicationId: 'LOS-2026-00123',
    });
    mockGet.mockResolvedValue([entry]);

    renderInWrapper(<LosStatusPanel leadId={LEAD_ID} />);

    // Wait for data to render.
    expect(await screen.findByText('LOS Application Status')).toBeDefined();
    // StatusChip renders the status text (underscores→spaces, lowercased by chip).
    // StatusChip calls status.replaceAll('_', ' ') — our value has no underscores.
    const chips = screen.getAllByText('CREDIT APPRAISAL');
    expect(chips.length).toBeGreaterThan(0);
    // IST formatted date (appears in metadata grid and timeline).
    const dateEls = screen.getAllByText('09-06-2026 16:00');
    expect(dateEls.length).toBeGreaterThan(0);
    // Received via label.
    const webhookLabels = screen.getAllByText('Webhook');
    expect(webhookLabels.length).toBeGreaterThan(0);
    // Application ID.
    const appIdEls = screen.getAllByText('LOS-2026-00123');
    expect(appIdEls.length).toBeGreaterThan(0);
    // Correlation ID.
    expect(screen.getByText('corr_xyz')).toBeDefined();
    // Read-only badge.
    expect(screen.getByText('LOS-owned · Read-only')).toBeDefined();
  });
});

// ── LosStatusTimeline tests ───────────────────────────────────────────────────

describe('LosStatusTimeline', () => {
  // U01 — StatusChip renders status with correct accessible label
  it('renders element with role="status" and aria-label for each entry (U01)', () => {
    const entries = [makeEntry({ status: 'CREDIT_APPRAISAL', receivedVia: 'webhook' })];
    render(<LosStatusTimeline entries={entries} />);

    const statusEl = screen.getByRole('status', { name: /LOS status: CREDIT_APPRAISAL/i });
    expect(statusEl).toBeDefined();
    // The chip text is visible.
    expect(screen.getByText('CREDIT APPRAISAL')).toBeDefined();
  });

  // U02 — received_via='poll' shows "Reconciliation poll" label
  it('shows "Reconciliation poll" for received_via=poll; "Webhook" not shown (U02)', () => {
    const entries = [makeEntry({ receivedVia: 'poll' })];
    render(<LosStatusTimeline entries={entries} />);

    expect(screen.getByText('Reconciliation poll')).toBeDefined();
    expect(screen.queryByText('Webhook')).toBeNull();
  });

  // Shows Webhook label for webhook entries
  it('shows "Webhook" for received_via=webhook', () => {
    const entries = [makeEntry({ receivedVia: 'webhook' })];
    render(<LosStatusTimeline entries={entries} />);

    expect(screen.getByText('Webhook')).toBeDefined();
  });

  // Multiple entries rendered
  it('renders all provided entries as list items', () => {
    const entries = [
      makeEntry({ losMirrorId: 'mir-001', status: 'APPROVED' }),
      makeEntry({ losMirrorId: 'mir-002', status: 'CREDIT_APPRAISAL' }),
    ];
    render(<LosStatusTimeline entries={entries} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });

  // Empty entries
  it('renders "No status history." when entries is empty', () => {
    render(<LosStatusTimeline entries={[]} />);
    expect(screen.getByText('No status history.')).toBeDefined();
  });
});
