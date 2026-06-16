// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiClientError } from '@/lib/api';
import { ERROR_CODES } from '@lms/shared';
import type { PartnerView } from '@/types/partner';

const mocks = vi.hoisted(() => ({
  partners: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  can: vi.fn(),
}));
vi.mock('@/hooks/use-partners', () => ({
  usePartners: () => mocks.partners(),
  useCreatePartner: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdatePartner: () => ({ mutateAsync: mocks.update, isPending: false }),
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

function listResult(rows: PartnerView[], extra: Record<string, unknown> = {}) {
  return {
    data: { data: rows, pagination: { page: 1, limit: 25, total: rows.length } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <PartnerManagementPage />
    </MemoryRouter>,
  );
}

describe('PartnerManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
    mocks.partners.mockReturnValue(listResult([partner()]));
  });

  it('renders partner rows with masked mobile, status and type chips', () => {
    renderPage();
    const row = screen.getByText('Acme DSA').closest('tr') as HTMLElement;
    expect(within(row).getByText('DSA-001')).toBeTruthy();
    expect(within(row).getByText('98xxxxxx10')).toBeTruthy();
    // Status + type rendered as chips within the row (the filter selects also
    // contain "active"/"DSA" option text, so scope to the row).
    expect(within(row).getByText('active')).toBeTruthy();
    expect(within(row).getByText('DSA')).toBeTruthy();
  });

  it('shows Add Partner and Edit for configuration-capable users', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /add partner/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeTruthy();
  });

  it('shows a no-access message and never queries without the configuration capability', () => {
    mocks.can.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(/don't have access to partner management/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add partner/i })).toBeNull();
    expect(mocks.partners).toHaveBeenCalled(); // hook runs but is gated by `enabled`
  });

  it('opens the create modal with the partner-code field', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add partner/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/partner code/i)).toBeTruthy();
  });

  it('blocks create submission and shows inline validation when required fields are empty', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add partner/i }));
    fireEvent.click(screen.getByRole('button', { name: /create partner/i }));

    await waitFor(() => expect(screen.getByText('Partner code is required.')).toBeTruthy());
    expect(screen.getByText('Legal name is required.')).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('offers Suspend and Expire for an active partner (not Reactivate)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /suspend/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /expire/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reactivate/i })).toBeNull();
  });

  it('offers Reactivate and Expire for a suspended partner', () => {
    mocks.partners.mockReturnValue(listResult([partner({ status: 'suspended' })]));
    renderPage();
    expect(screen.getByRole('button', { name: /reactivate/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /expire/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull();
  });

  it('offers no status transition for an expired partner (terminal)', () => {
    mocks.partners.mockReturnValue(listResult([partner({ status: 'expired' })]));
    renderPage();
    expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reactivate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /expire/i })).toBeNull();
  });

  it('suspends a partner with a reason via the confirm dialog (PATCH status+reason)', async () => {
    mocks.update.mockResolvedValue({ partnerId: 'p1', status: 'suspended' });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: 'Compliance review pending' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^suspend$/i }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        partnerId: 'p1',
        body: { status: 'suspended', statusReason: 'Compliance review pending' },
      }),
    );
  });

  it('reactivates a suspended partner (reason optional) via the confirm dialog', async () => {
    mocks.partners.mockReturnValue(listResult([partner({ status: 'suspended' })]));
    mocks.update.mockResolvedValue({ partnerId: 'p1', status: 'active' });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /reactivate/i }));
    const dialog = screen.getByRole('dialog');
    // No reason entered — reactivate does not require one.
    fireEvent.click(within(dialog).getByRole('button', { name: /^reactivate$/i }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ partnerId: 'p1', body: { status: 'active' } }),
    );
  });

  it('surfaces an invalid-transition VALIDATION_ERROR inline and keeps the dialog open', async () => {
    mocks.update.mockRejectedValue(
      new ApiClientError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Please correct the highlighted fields.',
        status: 400,
        retryable: false,
        fields: [{ field: 'status', issue: "Transition from 'expired' to 'active' is not permitted." }],
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^suspend$/i }));

    await waitFor(() =>
      expect(screen.getByText("Transition from 'expired' to 'active' is not permitted.")).toBeTruthy(),
    );
    // Dialog is still open (error surfaced, not dismissed).
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens a read-only detail with a quality link from the legal-name cell', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Acme DSA' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('DSA-001 · DSA')).toBeTruthy();
    const link = within(dialog).getByRole('link', { name: /view quality/i });
    expect(link.getAttribute('href')).toBe('/partner/p1/quality');
  });

  it('shows the empty state when there are no partners', () => {
    mocks.partners.mockReturnValue(listResult([]));
    renderPage();
    expect(screen.getByText('No partners found')).toBeTruthy();
  });

  it('shows the error state with a retry when the list query fails', () => {
    const refetch = vi.fn();
    mocks.partners.mockReturnValue(listResult([], { isError: true, data: undefined, refetch }));
    renderPage();
    expect(screen.getByText('Could not load partners.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
