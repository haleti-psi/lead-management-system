// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PartnerView } from '@/types/partner';

const mocks = vi.hoisted(() => ({ partners: vi.fn(), can: vi.fn() }));
vi.mock('@/hooks/use-partners', () => ({
  usePartners: () => mocks.partners(),
  useCreatePartner: () => ({ mutateAsync: vi.fn() }),
  useUpdatePartner: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PartnerManagementPage } from './PartnerManagementPage';

function partner(overrides: Partial<PartnerView> = {}): PartnerView {
  return {
    partnerId: 'p1',
    partnerCode: 'DSA-001',
    type: 'DSA',
    legalName: 'Acme DSA',
    branchId: null,
    products: ['home_loan'],
    contactPerson: 'Ravi',
    contactMobile: '98xxxxxx10',
    status: 'active',
    agreementRef: 'AGR-1',
    commissionFlag: true,
    mappedRmId: null,
    riskCategory: 'low',
    qualityScore: 82,
    validUntil: '2027-03-31',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-05-01T08:30:00Z',
    ...overrides,
  };
}

function withData(): void {
  mocks.partners.mockReturnValue({
    data: { data: [partner()], pagination: { page: 1, limit: 25, total: 1 } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

describe('PartnerManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
  });

  it('renders partner rows with a masked mobile and status chip', () => {
    withData();
    render(<PartnerManagementPage />);
    expect(screen.getByText('DSA-001')).toBeTruthy();
    expect(screen.getByText('Acme DSA')).toBeTruthy();
    expect(screen.getByText('98xxxxxx10')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('shows Add Partner and Edit for configuration-capable users', () => {
    withData();
    render(<PartnerManagementPage />);
    expect(screen.getByRole('button', { name: /add partner/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
  });

  it('hides Add/Edit without the configuration capability', () => {
    mocks.can.mockReturnValue(false);
    withData();
    render(<PartnerManagementPage />);
    expect(screen.queryByRole('button', { name: /add partner/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('opens the create modal', () => {
    withData();
    render(<PartnerManagementPage />);
    fireEvent.click(screen.getByRole('button', { name: /add partner/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText(/partner code/i)).toBeTruthy();
  });

  it('shows the empty state when there are no partners', () => {
    mocks.partners.mockReturnValue({
      data: { data: [], pagination: { page: 1, limit: 25, total: 0 } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartnerManagementPage />);
    expect(screen.getByText('No partners found')).toBeTruthy();
  });
});
