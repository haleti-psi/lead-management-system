// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), toastError: vi.fn() }));
vi.mock('@/hooks/use-create-grievance', () => ({
  useCreateGrievance: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));

import { GrievancePage } from './GrievancePage';

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/c/tok-1/grievance']}>
      <Routes>
        <Route path="/c/:token/grievance" element={<GrievancePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GrievancePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the category, description and submit', () => {
    renderPage();
    expect(screen.getByLabelText(/category/i)).toBeTruthy();
    expect(screen.getByLabelText(/description/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /submit grievance/i })).toBeTruthy();
  });

  it('submits and shows the reference number on success', async () => {
    mocks.mutateAsync.mockResolvedValue({
      grievanceId: 'g1',
      grievanceNo: 'GRV-2026-00031',
      status: 'open',
      sla_due_at: null,
      message: 'registered',
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'pending two weeks' } });
    fireEvent.click(screen.getByRole('button', { name: /submit grievance/i }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled());
    expect(await screen.findByText('Grievance registered')).toBeTruthy();
    expect(screen.getByText('GRV-2026-00031')).toBeTruthy();
  });

  it('surfaces an invalid-link error inline', async () => {
    const { ApiClientError } = await import('@/lib/api');
    mocks.mutateAsync.mockRejectedValue(
      new ApiClientError({ code: 'NOT_FOUND', message: 'x', status: 404, retryable: false }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'pending two weeks' } });
    fireEvent.click(screen.getByRole('button', { name: /submit grievance/i }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/no longer valid/i)));
  });
});
