// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  rollback: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/hooks/use-config-governance', () => ({
  useApproveConfig: () => ({ mutateAsync: mocks.approve, isPending: false }),
  useRollbackConfig: () => ({ mutateAsync: mocks.rollback, isPending: false }),
}));
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConfigGovernancePage } from './ConfigGovernancePage';

const VALID_ID = '11111111-1111-4111-8111-111111111111';

describe('ConfigGovernancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
  });

  it('shows a no-access message and no action controls without the configuration capability', () => {
    mocks.can.mockReturnValue(false);
    render(<ConfigGovernancePage />);
    expect(screen.getByText(/don't have access to configuration governance/i)).toBeTruthy();
    expect(screen.queryByLabelText(/configuration version id/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
  });

  it('renders the missing-list-endpoint notice and the id entry form for an authorised user', () => {
    render(<ConfigGovernancePage />);
    expect(screen.getByRole('heading', { name: 'Configuration Approvals' })).toBeTruthy();
    // The honest gap notice about the absent queue/list endpoint.
    expect(screen.getByRole('note')).toBeTruthy();
    expect(screen.getByText(/pending-changes queue is not yet available/i)).toBeTruthy();
    expect(screen.getByLabelText(/configuration version id/i)).toBeTruthy();
  });

  it('disables both actions until a valid UUID is entered', () => {
    render(<ConfigGovernancePage />);
    const review = screen.getByRole('button', { name: /review/i });
    const rollback = screen.getByRole('button', { name: /roll back/i });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    expect((rollback as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/configuration version id/i), {
      target: { value: VALID_ID },
    });
    expect((review as HTMLButtonElement).disabled).toBe(false);
    expect((rollback as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an inline UUID validation error for a malformed id', () => {
    render(<ConfigGovernancePage />);
    const input = screen.getByLabelText(/configuration version id/i);
    fireEvent.change(input, { target: { value: 'not-a-uuid' } });
    fireEvent.blur(input);
    expect(screen.getByText(/valid configuration-version id/i)).toBeTruthy();
  });

  it('opens the review dialog for a valid id', () => {
    render(<ConfigGovernancePage />);
    fireEvent.change(screen.getByLabelText(/configuration version id/i), {
      target: { value: VALID_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Review configuration change')).toBeTruthy();
    expect(within(dialog).getByLabelText(/approve/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/reject/i)).toBeTruthy();
  });

  it('opens the rollback dialog for a valid id', () => {
    render(<ConfigGovernancePage />);
    fireEvent.change(screen.getByLabelText(/configuration version id/i), {
      target: { value: VALID_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: /roll back/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Roll back configuration')).toBeTruthy();
    expect(within(dialog).getByLabelText(/reason/i)).toBeTruthy();
  });
});
