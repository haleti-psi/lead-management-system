// @vitest-environment jsdom
/**
 * FR-080 — EligibilityCard UI tests (FR-080-tests.md T22–T26).
 *
 * The TanStack Query hooks are mocked so the component runs without a network or
 * React Query Provider. The mutation hook is also mocked to avoid real network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── mock hooks before any import of the component ────────────────────────────

vi.mock('./hooks/use-eligibility', () => ({
  useEligibilitySnapshot: vi.fn(),
  useRequestEligibility: vi.fn(),
}));

// mock sonner toast to avoid DOM noise
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useEligibilitySnapshot, useRequestEligibility } from './hooks/use-eligibility';
import type { EligibilitySnapshot } from './hooks/use-eligibility';
import { EligibilityCard } from './EligibilityCard';

const mockUseQuery = useEligibilitySnapshot as ReturnType<typeof vi.fn>;
const mockUseMutation = useRequestEligibility as ReturnType<typeof vi.fn>;

const LEAD_ID = 'b0000000-0000-0000-0000-00000000000b';

function makeMutationIdle() {
  return { mutateAsync: vi.fn(), isPending: false };
}

function makeSnapshot(overrides: Partial<EligibilitySnapshot> = {}): EligibilitySnapshot {
  return {
    eligibilitySnapshotId: 'snap-001',
    leadId: LEAD_ID,
    requestRef: 'ELIG-L001-123',
    status: 'received',
    indicativeAmount: '500000.00',
    tenureMonths: 36,
    rateRange: '10.5-12.0',
    conditions: { note: 'Subject to verification' },
    validityUntil: '2026-07-09T00:00:00.000Z',
    responseBasis: 'indicative',
    createdAt: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockUseQuery.mockReset();
  mockUseMutation.mockReset();
  mockUseQuery.mockReturnValue({ data: undefined, refetch: vi.fn() });
  mockUseMutation.mockReturnValue(makeMutationIdle());
});

// ── T22: indicative label shown when responseBasis = 'indicative' ─────────────

describe('EligibilityCard — T22: indicative label', () => {
  it('shows "Indicative" badge when responseBasis is indicative', () => {
    mockUseQuery.mockReturnValue({ data: makeSnapshot({ responseBasis: 'indicative' }), refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="kyc_in_progress" consentPresent initialSnapshot={makeSnapshot()} />);

    expect(screen.getByText('Indicative')).toBeDefined();
    expect(screen.queryByText('Final')).toBeNull();
  });

  it('has no edit controls (read-only invariant)', () => {
    mockUseQuery.mockReturnValue({ data: makeSnapshot(), refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="kyc_in_progress" consentPresent initialSnapshot={makeSnapshot()} />);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});

// ── T23: "Final" badge shown when responseBasis = 'final' ────────────────────

describe('EligibilityCard — T23: final label', () => {
  it('shows "Final" badge and no "Indicative" badge', () => {
    const snap = makeSnapshot({ responseBasis: 'final' });
    mockUseQuery.mockReturnValue({ data: snap, refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="kyc_in_progress" consentPresent initialSnapshot={snap} />);

    expect(screen.getByText('Final')).toBeDefined();
    expect(screen.queryByText('Indicative')).toBeNull();
  });
});

// ── T24: LoadingSkeleton shown while pending ──────────────────────────────────

describe('EligibilityCard — T24: pending skeleton', () => {
  it('shows LoadingSkeleton and "Awaiting LOS response" text when status is pending', () => {
    const snap = makeSnapshot({ status: 'pending', indicativeAmount: null, tenureMonths: null, rateRange: null, conditions: null, validityUntil: null, responseBasis: null });
    mockUseQuery.mockReturnValue({ data: snap, refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="kyc_in_progress" consentPresent initialSnapshot={snap} />);

    // LoadingSkeleton renders role="status" aria-label="Loading"
    expect(screen.getByRole('status', { name: /loading/i })).toBeDefined();
    expect(screen.getByText(/awaiting los response/i)).toBeDefined();
    // Retry button absent while pending
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

// ── T25: EmptyState with request button when no snapshot ─────────────────────

describe('EligibilityCard — T25: empty state', () => {
  it('shows EmptyState and "Request Eligibility" button when lead is kyc_in_progress and consent present', () => {
    mockUseQuery.mockReturnValue({ data: null, refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="kyc_in_progress" consentPresent initialSnapshot={null} />);

    expect(screen.getByRole('button', { name: /request eligibility/i })).toBeDefined();
  });

  it('shows consent-missing message and no request button when consent is absent', () => {
    mockUseQuery.mockReturnValue({ data: null, refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="kyc_in_progress" consentPresent={false} initialSnapshot={null} />);

    expect(screen.getByText(/consent for product eligibility/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /request eligibility/i })).toBeNull();
  });
});

// ── T26: DisabledOverlay for terminal stage ───────────────────────────────────

describe('EligibilityCard — T26: disabled overlay for terminal stage', () => {
  it('renders disabled overlay and no request button when stage is handed_off', () => {
    mockUseQuery.mockReturnValue({ data: null, refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="handed_off" consentPresent initialSnapshot={null} />);

    expect(screen.getByText(/terminal stage/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /request eligibility/i })).toBeNull();
  });

  it('renders disabled overlay when stage is rejected', () => {
    mockUseQuery.mockReturnValue({ data: null, refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="rejected" consentPresent initialSnapshot={null} />);

    expect(screen.getByText(/terminal stage/i)).toBeDefined();
  });
});

// ── Scope negative: failed state shows retry button ──────────────────────────

describe('EligibilityCard — failed state', () => {
  it('shows ErrorState and retry button when status is failed', () => {
    const snap = makeSnapshot({ status: 'failed', indicativeAmount: null, tenureMonths: null, rateRange: null, conditions: null, validityUntil: null, responseBasis: null });
    mockUseQuery.mockReturnValue({ data: snap, refetch: vi.fn() });

    render(<EligibilityCard leadId={LEAD_ID} leadStage="kyc_in_progress" consentPresent initialSnapshot={snap} />);

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();
  });
});
