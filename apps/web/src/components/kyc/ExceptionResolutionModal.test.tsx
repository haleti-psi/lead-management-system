// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/use-resolve-kyc-exception', () => ({
  useResolveKycException: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import { ExceptionResolutionModal } from './ExceptionResolutionModal';

function renderModal(overrides: Partial<Parameters<typeof ExceptionResolutionModal>[0]> = {}): {
  onClose: ReturnType<typeof vi.fn>;
  onResolved: ReturnType<typeof vi.fn>;
} {
  const onClose = vi.fn();
  const onResolved = vi.fn();
  render(
    <ExceptionResolutionModal
      open
      leadId="lead-1"
      kycVerificationId="kv-1"
      exceptionLabel="PAN"
      onClose={onClose}
      onResolved={onResolved}
      {...overrides}
    />,
  );
  return { onClose, onResolved };
}

describe('ExceptionResolutionModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('UT-01 renders resolution code select, remarks, and submit', () => {
    renderModal();
    expect(screen.getByLabelText(/resolution code/i)).toBeTruthy();
    expect(screen.getByLabelText(/remarks/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /resolve exception/i })).toBeTruthy();
  });

  it('UT-02 shows the evidence field only for waiver/provider_down codes', () => {
    renderModal();
    expect(screen.queryByLabelText(/evidence/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/resolution code/i), { target: { value: 'waiver' } });
    expect(screen.getByLabelText(/evidence/i)).toBeTruthy();
  });

  it('UT-04 resolves, toasts, and closes on success', async () => {
    mocks.mutateAsync.mockResolvedValue({ kycVerificationId: 'kv-1', status: 'success', resolutionCode: 're_verified' });
    const { onClose, onResolved } = renderModal();

    fireEvent.change(screen.getByLabelText(/remarks/i), { target: { value: 'PAN re-checked' } });
    fireEvent.click(screen.getByRole('button', { name: /resolve exception/i }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled());
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      kycVerificationId: 'kv-1',
      body: { resolutionCode: 're_verified', remarks: 'PAN re-checked' },
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(onResolved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('UT-03 blocks waiver submit without evidence (client validation)', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/resolution code/i), { target: { value: 'waiver' } });
    fireEvent.change(screen.getByLabelText(/remarks/i), { target: { value: 'waiving' } });
    fireEvent.click(screen.getByRole('button', { name: /resolve exception/i }));
    expect(await screen.findByText(/evidence reference is required/i)).toBeTruthy();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
