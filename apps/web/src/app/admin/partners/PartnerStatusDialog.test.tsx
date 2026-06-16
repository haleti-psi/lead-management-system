// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiClientError } from '@/lib/api';
import { ERROR_CODES } from '@lms/shared';
import type { PartnerView } from '@/types/partner';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/hooks/use-partners', () => ({
  useUpdatePartner: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PartnerStatusDialog } from './PartnerStatusDialog';

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

describe('PartnerStatusDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a reason before suspend can be submitted', async () => {
    render(<PartnerStatusDialog partner={partner()} target="suspended" onClose={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: /^suspend$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Compliance' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    mocks.update.mockResolvedValue({ partnerId: 'p1', status: 'suspended' });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        partnerId: 'p1',
        body: { status: 'suspended', statusReason: 'Compliance' },
      }),
    );
  });

  it('allows reactivation without a reason (optional)', async () => {
    mocks.update.mockResolvedValue({ partnerId: 'p1', status: 'active' });
    const onClose = vi.fn();
    render(
      <PartnerStatusDialog partner={partner({ status: 'suspended' })} target="active" onClose={onClose} />,
    );
    const confirm = screen.getByRole('button', { name: /^reactivate$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ partnerId: 'p1', body: { status: 'active' } }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces the VALIDATION_ERROR status field issue inline and stays open', async () => {
    mocks.update.mockRejectedValue(
      new ApiClientError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Please correct the highlighted fields.',
        status: 400,
        retryable: false,
        fields: [{ field: 'status', issue: "Transition from 'active' to 'expired' is not permitted." }],
      }),
    );
    const onClose = vi.fn();
    render(<PartnerStatusDialog partner={partner()} target="expired" onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^expire$/i }));

    await waitFor(() =>
      expect(screen.getByText("Transition from 'active' to 'expired' is not permitted.")).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a CONFLICT (stale state) reason inline', async () => {
    mocks.update.mockRejectedValue(
      new ApiClientError({
        code: ERROR_CODES.CONFLICT,
        message: 'Conflict',
        status: 409,
        retryable: false,
        detail: { reason: 'The partner was changed by someone else.' },
      }),
    );
    render(<PartnerStatusDialog partner={partner()} target="suspended" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^suspend$/i }));
    await waitFor(() =>
      expect(screen.getByText('The partner was changed by someone else.')).toBeTruthy(),
    );
  });

  it('surfaces a FORBIDDEN denial inline (BM cannot change status)', async () => {
    mocks.update.mockRejectedValue(
      new ApiClientError({ code: ERROR_CODES.FORBIDDEN, message: 'Forbidden', status: 403, retryable: false }),
    );
    render(<PartnerStatusDialog partner={partner()} target="suspended" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^suspend$/i }));
    await waitFor(() =>
      expect(screen.getByText(/don't have access to change this partner's status/i)).toBeTruthy(),
    );
  });
});
