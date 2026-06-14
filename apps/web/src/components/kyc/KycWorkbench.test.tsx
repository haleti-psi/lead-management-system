// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KycType } from '@lms/shared';
import { ApiClientError } from '@/lib/api';
import type { KycVerificationData } from '@/types/kyc';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  can: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/use-kyc', () => ({ useRunKyc: () => ({ mutate: mocks.mutate, isPending: false }) }));
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import { KycWorkbench } from './KycWorkbench';

function panSuccess(): KycVerificationData {
  return {
    kycVerificationId: 'kv-1',
    leadId: 'lead-1',
    kycType: KycType.PAN,
    status: 'success',
    reference: null,
    maskedResponse: { panStatus: 'valid', nameMatch: true, maskedPan: 'ABCDE****F' },
    exceptionType: null,
    createdAt: '2026-06-14T00:00:00Z',
  };
}

function verifyPan(): void {
  fireEvent.change(screen.getByLabelText('PAN number'), { target: { value: 'ABCDE1234F' } });
  fireEvent.click(screen.getAllByRole('button', { name: /verify/i })[0]);
}

describe('KycWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
  });

  it('renders PAN enabled and the Phase-1.5 checks as coming soon', () => {
    render(<KycWorkbench leadId="lead-1" />);
    expect(screen.getByText('PAN')).toBeTruthy();
    expect(screen.getByText('CKYC')).toBeTruthy();
    expect(screen.getAllByText('(coming soon)').length).toBe(4);
  });

  it('disables verify actions without verify_doc', () => {
    mocks.can.mockReturnValue(false);
    render(<KycWorkbench leadId="lead-1" />);
    for (const btn of screen.getAllByRole('button', { name: /verify/i })) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('shows Verified + masked PAN on success', () => {
    mocks.mutate.mockImplementation((_input, opts) => {
      opts.onSuccess(panSuccess());
      opts.onSettled?.();
    });
    render(<KycWorkbench leadId="lead-1" />);
    verifyPan();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('ABCDE****F')).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it('surfaces the consent gate on 403 CONSENT_MISSING', () => {
    mocks.mutate.mockImplementation((_input, opts) => {
      opts.onError(
        new ApiClientError({
          code: 'FORBIDDEN',
          message: 'forbidden',
          status: 403,
          retryable: false,
          detail: { reason: 'CONSENT_MISSING' },
        }),
      );
      opts.onSettled?.();
    });
    render(<KycWorkbench leadId="lead-1" />);
    verifyPan();
    expect(screen.getByText('KYC consent required')).toBeTruthy();
  });

  it('shows the exception banner when the provider is down (503)', () => {
    mocks.mutate.mockImplementation((_input, opts) => {
      opts.onError(
        new ApiClientError({
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'unavailable',
          status: 503,
          retryable: true,
        }),
      );
      opts.onSettled?.();
    });
    render(<KycWorkbench leadId="lead-1" />);
    verifyPan();
    expect(screen.getByText('KYC needs attention')).toBeTruthy();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('shows the exception banner on a mismatch result', () => {
    mocks.mutate.mockImplementation((_input, opts) => {
      opts.onSuccess({ ...panSuccess(), status: 'failed', exceptionType: 'name_mismatch' });
      opts.onSettled?.();
    });
    render(<KycWorkbench leadId="lead-1" />);
    verifyPan();
    expect(screen.getByText('KYC needs attention')).toBeTruthy();
    expect(mocks.toastError).toHaveBeenCalled();
  });
});
