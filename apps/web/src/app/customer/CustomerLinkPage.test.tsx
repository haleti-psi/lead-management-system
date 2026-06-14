// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CustomerOpenData } from '@/types/customer-link';

const mocks = vi.hoisted(() => ({ open: vi.fn(), verify: vi.fn() }));
vi.mock('@/hooks/use-customer-link', () => ({
  useCustomerLink: () => mocks.open(),
  useVerifyOtp: () => ({ mutate: mocks.verify, isPending: false }),
}));

import { CustomerLinkPage } from './CustomerLinkPage';

function renderAt(path = '/c/tok-1'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/c/:token" element={<CustomerLinkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const openData = (overrides: Partial<CustomerOpenData> = {}): CustomerOpenData => ({
  customer_link_id: 'l1',
  lead_id: 'lead-1',
  purpose: ['upload', 'consent'],
  otp_required: true,
  otp_verified: false,
  lead_display: { product_display_name: 'CV Loan', status_label: 'Documents Pending' },
  ...overrides,
});

describe('CustomerLinkPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loading state while fetching', () => {
    mocks.open.mockReturnValue({ isLoading: true });
    renderAt();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('shows a friendly terminal state for an invalid/expired link', () => {
    mocks.open.mockReturnValue({ isLoading: false, isError: true });
    renderAt();
    expect(screen.getByText('This link is no longer valid')).toBeTruthy();
  });

  it('shows the OTP gate when not verified', () => {
    mocks.open.mockReturnValue({ isLoading: false, isError: false, data: openData({ otp_verified: false }) });
    renderAt();
    expect(screen.getByLabelText('One-time password')).toBeTruthy();
  });

  it('shows the purpose-gated home once verified', () => {
    mocks.open.mockReturnValue({ isLoading: false, isError: false, data: openData({ otp_verified: true }) });
    renderAt();
    expect(screen.getByText('Upload documents')).toBeTruthy();
    expect(screen.getByRole('link', { name: /upload a document/i })).toBeTruthy();
  });
});
