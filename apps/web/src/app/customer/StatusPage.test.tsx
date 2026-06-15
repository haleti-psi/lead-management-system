// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CustomerStatusData } from '@/hooks/use-customer-status';

const mocks = vi.hoisted(() => ({ status: vi.fn(), callback: vi.fn() }));
vi.mock('@/hooks/use-customer-status', () => ({
  useCustomerStatus: () => mocks.status(),
  useRequestCallback: () => ({ mutateAsync: mocks.callback }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { StatusPage } from './StatusPage';

function renderAt(): void {
  render(
    <MemoryRouter initialEntries={['/c/tok-1/status']}>
      <Routes>
        <Route path="/c/:token/status" element={<StatusPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const statusData = (overrides: Partial<CustomerStatusData> = {}): CustomerStatusData => ({
  lead_code: 'LD-2026-000123',
  customer_name: 'Rajesh K.',
  stage_label: 'Documents Required',
  stage_description: 'We need a few documents from you.',
  pending_actions: ['Upload Pan'],
  is_handed_off: false,
  los_status_label: null,
  ...overrides,
});

describe('StatusPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loading state', () => {
    mocks.status.mockReturnValue({ isLoading: true });
    renderAt();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('shows a terminal state for an invalid link', () => {
    mocks.status.mockReturnValue({ isLoading: false, isError: true });
    renderAt();
    expect(screen.getByText('This link is no longer valid')).toBeTruthy();
  });

  it('renders the stage label, description, pending actions, and callback form', () => {
    mocks.status.mockReturnValue({ isLoading: false, isError: false, data: statusData() });
    renderAt();
    expect(screen.getByText('Documents Required')).toBeTruthy();
    expect(screen.getByText('Upload Pan')).toBeTruthy();
    expect(screen.getByText('Request a callback')).toBeTruthy();
    expect(screen.getByLabelText(/preferred time/i)).toBeTruthy();
  });

  it('hides the callback form once handed off', () => {
    mocks.status.mockReturnValue({
      isLoading: false,
      isError: false,
      data: statusData({ is_handed_off: true, stage_label: 'With Lending Team', pending_actions: [] }),
    });
    renderAt();
    expect(screen.getByText('With Lending Team')).toBeTruthy();
    expect(screen.queryByText('Request a callback')).toBeNull();
  });

  it('submits a callback and shows confirmation', async () => {
    mocks.status.mockReturnValue({ isLoading: false, isError: false, data: statusData() });
    mocks.callback.mockResolvedValue({ task_id: 't1', message: 'received' });
    renderAt();
    fireEvent.change(screen.getByLabelText(/preferred time/i), { target: { value: '2026-06-12T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /request callback/i }));
    await waitFor(() => expect(mocks.callback).toHaveBeenCalled());
    expect(await screen.findByText(/callback request has been received/i)).toBeTruthy();
  });
});
