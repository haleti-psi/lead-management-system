// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApiClientError } from '@/lib/api';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), toastError: vi.fn() }));
vi.mock('@/hooks/use-customer-link', () => ({ useVerifyOtp: () => ({ mutate: mocks.mutate, isPending: false }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

import { OtpGate } from './OtpGate';

describe('OtpGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a one-time-password input and verify button', () => {
    render(<OtpGate token="tok" />);
    expect(screen.getByLabelText('One-time password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /verify/i })).toBeTruthy();
  });

  it('submits a 6-digit code', () => {
    render(<OtpGate token="tok" />);
    fireEvent.change(screen.getByLabelText('One-time password'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(mocks.mutate).toHaveBeenCalledWith('123456', expect.any(Object));
  });

  it('keeps the verify button disabled until 6 digits are entered', () => {
    render(<OtpGate token="tok" />);
    fireEvent.change(screen.getByLabelText('One-time password'), { target: { value: '123' } });
    expect((screen.getByRole('button', { name: /verify/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a rate-limit message on 429', () => {
    mocks.mutate.mockImplementation((_otp, opts) =>
      opts.onError(new ApiClientError({ code: 'RATE_LIMITED', message: 'x', status: 429, retryable: true })),
    );
    render(<OtpGate token="tok" />);
    fireEvent.change(screen.getByLabelText('One-time password'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/too many attempts/i));
  });
});
