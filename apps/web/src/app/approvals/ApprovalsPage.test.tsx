// @vitest-environment jsdom
//
// FR-055 — ApprovalsPage component tests.
// The hook is mocked so the component runs without a real network or server.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── mock useLeads (lead list query) ──────────────────────────────────────────
vi.mock('@/hooks/use-leads', () => ({
  useLeads: vi.fn(),
  leadKeys: { all: ['leads'], list: (p: unknown) => ['leads', p] },
}));

// ── mock useLeadApproval ──────────────────────────────────────────────────────
vi.mock('@/hooks/use-lead-approval', () => ({
  useLeadApproval: vi.fn(),
  approvalErrorMessage: vi.fn((err: unknown) => String(err)),
}));

import { useLeads } from '@/hooks/use-leads';
import { useLeadApproval } from '@/hooks/use-lead-approval';
import { ApprovalsPage } from './ApprovalsPage';
import type { LeadListItem } from '@/types/lead';

const mockUseLeads = useLeads as ReturnType<typeof vi.fn>;
const mockUseLeadApproval = useLeadApproval as ReturnType<typeof vi.fn>;

const mutateMock = vi.fn();

function makeLead(overrides: Partial<LeadListItem> = {}): LeadListItem {
  return {
    lead_id: 'lead-001',
    lead_code: 'LD-2026-001',
    stage: 'pending_approval',
    product_code: 'CV',
    is_hot: false,
    score: null,
    consent_status: 'captured',
    kyc_status: 'verified',
    name_masked: 'Anil S',
    mobile_masked: null,
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <ApprovalsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseLeadApproval.mockReturnValue({
    mutate: mutateMock,
    isPending: false,
  });
});

describe('ApprovalsPage', () => {
  it('AP-01: shows loading state while query is pending', () => {
    mockUseLeads.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // DataTable renders role="status" while loading
    expect(screen.getByRole('status', { name: /loading/i })).not.toBeNull();
  });

  it('AP-02: shows empty state when no pending approvals', () => {
    mockUseLeads.mockReturnValue({
      data: { data: [], pagination: { total: 0, page: 1, limit: 25 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('No leads awaiting approval')).not.toBeNull();
  });

  it('AP-03: renders lead rows with Approve and Reject buttons', () => {
    mockUseLeads.mockReturnValue({
      data: { data: [makeLead()], pagination: { total: 1, page: 1, limit: 25 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('LD-2026-001')).not.toBeNull();
    expect(screen.getByRole('button', { name: /approve lead LD-2026-001/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /reject lead LD-2026-001/i })).not.toBeNull();
  });

  it('AP-04: clicking Approve calls mutation with decision=approve', () => {
    mockUseLeads.mockReturnValue({
      data: { data: [makeLead()], pagination: { total: 1, page: 1, limit: 25 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /approve lead LD-2026-001/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith(
      { decision: 'approve' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('AP-05: clicking Reject reveals reason input and cancel button', () => {
    mockUseLeads.mockReturnValue({
      data: { data: [makeLead()], pagination: { total: 1, page: 1, limit: 25 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /reject lead LD-2026-001/i }));

    expect(screen.getByPlaceholderText(/reason for rejection/i)).not.toBeNull();
    expect(screen.getByRole('button', { name: /confirm rejection/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /cancel/i })).not.toBeNull();
  });

  it('AP-06: reject validation shows alert when reason is too short', () => {
    mockUseLeads.mockReturnValue({
      data: { data: [makeLead()], pagination: { total: 1, page: 1, limit: 25 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /reject lead LD-2026-001/i }));
    const input = screen.getByPlaceholderText(/reason for rejection/i);
    fireEvent.change(input, { target: { value: 'abc' } }); // too short
    fireEvent.click(screen.getByRole('button', { name: /confirm rejection/i }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('5 characters');
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('AP-07: reject mutation is called with reason when input is valid', () => {
    mockUseLeads.mockReturnValue({
      data: { data: [makeLead()], pagination: { total: 1, page: 1, limit: 25 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /reject lead LD-2026-001/i }));
    const input = screen.getByPlaceholderText(/reason for rejection/i);
    fireEvent.change(input, { target: { value: 'Not eligible for this product' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm rejection/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith(
      { decision: 'reject', reason: 'Not eligible for this product' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('AP-08: error state does not show empty state UI', () => {
    mockUseLeads.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Network failure'),
      refetch: vi.fn(),
    });

    renderPage();

    // When errored, the empty state should not be shown
    expect(screen.queryByText('No leads awaiting approval')).toBeNull();
  });

  it('AP-09: page header is visible', () => {
    mockUseLeads.mockReturnValue({
      data: { data: [], pagination: { total: 0, page: 1, limit: 25 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('Approvals')).not.toBeNull();
  });
});
