// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Hoisted mock fns so the (hoisted) vi.mock factories can close over them.
const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  verifyMfa: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ login: mocks.login, verifyMfa: mocks.verifyMfa }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

import { LoginPage } from './LoginPage';
import { ApiClientError } from '@/lib/api';

function renderPage(): void {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

async function signIn(): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'rm-user' } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders username, password and submit (UI-001)', () => {
    renderPage();
    expect(screen.getByLabelText(/Username/)).toBeTruthy();
    expect(screen.getByLabelText(/Password/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows inline errors on empty submit without navigating (UI-002)', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('navigates on a successful non-MFA login', async () => {
    mocks.login.mockResolvedValue({ mfaRequired: false });
    renderPage();
    await signIn();

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('rm-user', 'pw'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('transitions to the OTP view when MFA is required (UI-005)', async () => {
    mocks.login.mockResolvedValue({ mfaRequired: true, challengeToken: 'ch-1', method: 'totp' });
    renderPage();
    await signIn();

    expect(await screen.findByText(/Enter the 6-digit code/)).toBeTruthy();
    expect(screen.getByLabelText(/One-time code/)).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows the rate-limit toast on 429 (UI-003)', async () => {
    mocks.login.mockRejectedValue(
      new ApiClientError({ code: 'RATE_LIMITED', message: 'x', status: 429, retryable: true }),
    );
    renderPage();
    await signIn();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Too many attempts. Please wait and try again.'),
    );
  });
});
