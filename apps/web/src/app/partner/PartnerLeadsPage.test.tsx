// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PartnerLeadView } from '@/types/partner-lead';

const mocks = vi.hoisted(() => ({ leads: vi.fn(), submit: vi.fn() }));
vi.mock('@/hooks/use-partner-leads', () => ({
  usePartnerLeads: () => mocks.leads(),
  useSubmitPartnerLead: () => ({ mutateAsync: mocks.submit }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PartnerLeadsPage } from './PartnerLeadsPage';

function lead(overrides: Partial<PartnerLeadView> = {}): PartnerLeadView {
  return {
    lead_id: 'l1',
    lead_code: 'LD-2026-000123',
    stage: 'assigned',
    product_code: 'CV',
    duplicate_status: 'none',
    name_masked: 'Ramesh xxxxx',
    mobile_masked: '98xxxxxx10',
    created_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

describe('PartnerLeadsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the partner own leads (masked)', () => {
    mocks.leads.mockReturnValue({
      data: { data: [lead()], pagination: { page: 1, limit: 25, total: 1 } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartnerLeadsPage />);
    expect(screen.getByText('LD-2026-000123')).toBeTruthy();
    expect(screen.getByText('Ramesh xxxxx')).toBeTruthy();
    expect(screen.getByText('98xxxxxx10')).toBeTruthy();
  });

  it('shows the empty state with no leads', () => {
    mocks.leads.mockReturnValue({
      data: { data: [], pagination: { page: 1, limit: 25, total: 0 } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartnerLeadsPage />);
    expect(screen.getByText('No leads yet')).toBeTruthy();
  });

  it('opens the submit-lead modal', () => {
    mocks.leads.mockReturnValue({
      data: { data: [], pagination: { page: 1, limit: 25, total: 0 } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartnerLeadsPage />);
    fireEvent.click(screen.getByRole('button', { name: /submit lead/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText(/customer name/i)).toBeTruthy();
    expect(screen.getByLabelText(/^mobile/i)).toBeTruthy();
  });
});
