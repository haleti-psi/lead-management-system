// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { ApiClientError } from '@/lib/api';
import { ERROR_CODES } from '@lms/shared';
import type { PartnerView } from '@/types/partner';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('@/hooks/use-partners', () => ({
  useCreatePartner: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdatePartner: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PartnerForm } from './PartnerForm';

function partner(overrides: Partial<PartnerView> = {}): PartnerView {
  return {
    partnerId: 'p1',
    partnerCode: 'DSA-001',
    type: 'DSA',
    legalName: 'Acme DSA',
    branchId: null,
    products: ['home_loan', 'lap'],
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

describe('PartnerForm (create)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows inline validation and does not submit when required fields are empty', async () => {
    render(<PartnerForm onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create partner/i }));
    await waitFor(() => expect(screen.getByText('Partner code is required.')).toBeTruthy());
    expect(screen.getByText('Legal name is required.')).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid partner code with the format message', async () => {
    render(<PartnerForm onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/partner code/i), { target: { value: 'bad code!' } });
    fireEvent.change(screen.getByLabelText(/legal name/i), { target: { value: 'Beta DSA' } });
    fireEvent.click(screen.getByRole('button', { name: /create partner/i }));
    await waitFor(() => expect(screen.getByText(/letters, numbers, - or _ only/i)).toBeTruthy());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a partner with the trimmed body and split products on success', async () => {
    mocks.create.mockResolvedValue({ partnerId: 'new' });
    const onClose = vi.fn();
    render(<PartnerForm onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/partner code/i), { target: { value: 'DSA-002' } });
    fireEvent.change(screen.getByLabelText(/legal name/i), { target: { value: 'Beta DSA' } });
    fireEvent.change(screen.getByLabelText(/products/i), { target: { value: 'personal_loan, home_loan' } });
    fireEvent.click(screen.getByRole('button', { name: /create partner/i }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerCode: 'DSA-002',
        type: 'DSA',
        legalName: 'Beta DSA',
        products: ['personal_loan', 'home_loan'],
      }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Partner created.');
  });

  it('shows a toast when the code already exists (CONFLICT)', async () => {
    mocks.create.mockRejectedValue(
      new ApiClientError({ code: ERROR_CODES.CONFLICT, message: 'Conflict', status: 409, retryable: false }),
    );
    render(<PartnerForm onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/partner code/i), { target: { value: 'DSA-001' } });
    fireEvent.change(screen.getByLabelText(/legal name/i), { target: { value: 'Dup DSA' } });
    fireEvent.click(screen.getByRole('button', { name: /create partner/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A partner with that code already exists.'));
  });
});

describe('PartnerForm (edit)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prefills metadata and has no status field (status is dialog-only)', () => {
    render(<PartnerForm partner={partner()} onClose={vi.fn()} />);
    expect((screen.getByLabelText(/legal name/i) as HTMLInputElement).value).toBe('Acme DSA');
    expect((screen.getByLabelText(/products/i) as HTMLInputElement).value).toBe('home_loan, lap');
    // The metadata form must NOT expose a free status selector.
    expect(screen.queryByLabelText(/^status$/i)).toBeNull();
    // partnerCode/type are immutable — not editable inputs here.
    expect(screen.queryByLabelText(/partner code/i)).toBeNull();
  });

  it('submits a metadata-only update (no status in the body)', async () => {
    mocks.update.mockResolvedValue({ partnerId: 'p1' });
    const onClose = vi.fn();
    render(<PartnerForm partner={partner()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/legal name/i), { target: { value: 'Acme DSA Updated' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const arg = mocks.update.mock.calls[0][0];
    expect(arg.partnerId).toBe('p1');
    expect(arg.body.legalName).toBe('Acme DSA Updated');
    expect(arg.body.status).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });
});
