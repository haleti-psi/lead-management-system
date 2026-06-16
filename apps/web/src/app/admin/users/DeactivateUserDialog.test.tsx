// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiClientError } from '@/lib/api';
import type { UserView } from '@/types/admin';

const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), users: vi.fn() }));

vi.mock('@/hooks/use-admin-users', () => ({
  useUpdateUser: () => ({ mutateAsync: mocks.updateUser, isPending: false }),
  useAdminUsers: () => mocks.users(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeactivateUserDialog } from './DeactivateUserDialog';

function user(overrides: Partial<UserView> = {}): UserView {
  return {
    user_id: 'u1',
    username: 'jdoe',
    full_name: 'Jane Doe',
    email: 'j***@example.com',
    mobile: '98xxxxxx10',
    role_id: 'r1',
    role_code: 'RM',
    branch_id: null,
    team_id: null,
    region_id: null,
    partner_id: null,
    product_skills: null,
    mfa_enabled: false,
    status: 'active',
    reporting_manager_id: null,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function candidateList() {
  return {
    data: {
      data: [user({ user_id: 'u2', username: 'rsingh', full_name: 'Ravi Singh' })],
      pagination: { page: 1, limit: 100, total: 1 },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

describe('DeactivateUserDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.users.mockReturnValue(candidateList());
  });

  it('keeps the confirm button disabled until a reason is entered', () => {
    render(<DeactivateUserDialog user={user()} onClose={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: /deactivate user/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Left the company' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('deactivates with status=inactive when there are no open leads', async () => {
    const onClose = vi.fn();
    mocks.updateUser.mockResolvedValue(user({ status: 'inactive' }));
    render(<DeactivateUserDialog user={user()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Left the company' } });
    fireEvent.click(screen.getByRole('button', { name: /deactivate user/i }));

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({ userId: 'u1', body: { status: 'inactive' } }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('surfaces a reassign target when the server reports open leads, then re-submits with reassign_to', async () => {
    mocks.updateUser
      .mockRejectedValueOnce(
        new ApiClientError({
          code: 'CONFLICT',
          message: 'conflict',
          status: 409,
          retryable: false,
          detail: { open_lead_count: 3 },
        }),
      )
      .mockResolvedValueOnce(user({ status: 'inactive' }));

    render(<DeactivateUserDialog user={user()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Left the company' } });
    fireEvent.click(screen.getByRole('button', { name: /deactivate user/i }));

    // After the CONFLICT, the reassign select and lead count appear.
    expect(await screen.findByLabelText(/reassign open leads to/i)).toBeTruthy();
    expect(screen.getByText(/3 open leads will be reassigned/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/reassign open leads to/i), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: /deactivate user/i }));

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenLastCalledWith({
        userId: 'u1',
        body: { status: 'inactive', reassign_to: 'u2' },
      }),
    );
  });
});
