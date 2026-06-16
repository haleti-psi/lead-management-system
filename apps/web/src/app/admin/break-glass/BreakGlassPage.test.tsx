// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApiClientError } from '@/lib/api';
import type { BreakGlassGrantListItem } from '@/types/break-glass';

const mocks = vi.hoisted(() => ({
  grants: vi.fn(),
  request: vi.fn(),
  approve: vi.fn(),
  revoke: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/hooks/use-break-glass', () => ({
  useBreakGlassGrants: () => mocks.grants(),
  useRequestBreakGlass: () => ({ mutateAsync: mocks.request, isPending: false }),
  useApproveBreakGlass: () => ({ mutateAsync: mocks.approve, isPending: false }),
  useRevokeBreakGlass: () => ({ mutateAsync: mocks.revoke, isPending: false }),
}));
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { userId: 'me-uuid', orgId: 'org-1', role: 'ADMIN', scope: 'A' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BreakGlassPage } from './BreakGlassPage';

const GRANTEE = '11111111-1111-4111-8111-111111111111';
const APPROVER = '22222222-2222-4222-8222-222222222222';
const SCOPE_REF = '33333333-3333-4333-8333-333333333333';

function grant(overrides: Partial<BreakGlassGrantListItem> = {}): BreakGlassGrantListItem {
  return {
    grantId: 'g1',
    granteeId: GRANTEE,
    makerId: 'maker-1',
    approverId: APPROVER,
    scopeType: 'lead',
    scopeRef: SCOPE_REF,
    status: 'pending',
    reason: 'Incident #4471 — data review',
    validFrom: '2026-06-16T09:00:00Z',
    validUntil: '2026-06-16T11:00:00Z',
    ...overrides,
  };
}

function listResult(rows: BreakGlassGrantListItem[], total = rows.length) {
  return {
    data: { data: rows, pagination: { page: 1, limit: 25, total } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function apiError(code: string, status: number): ApiClientError {
  return new ApiClientError({ code: code as never, message: `${code} message`, status, retryable: false });
}

describe('BreakGlassPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
    mocks.grants.mockReturnValue(listResult([grant()]));
  });

  it('renders the grants table with scope, status chip, valid-until and reason', () => {
    render(<BreakGlassPage />);
    expect(screen.getByText(GRANTEE)).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
    expect(screen.getByText('Incident #4471 — data review')).toBeTruthy();
    // scopeRef appears alongside the scope type
    expect(screen.getByText(SCOPE_REF)).toBeTruthy();
  });

  it('hides the page when the user lacks the break_glass capability', () => {
    mocks.can.mockReturnValue(false);
    render(<BreakGlassPage />);
    expect(screen.getByText(/don't have access to break-glass/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /request grant/i })).toBeNull();
  });

  it('shows the empty state when there are no grants', () => {
    mocks.grants.mockReturnValue(listResult([], 0));
    render(<BreakGlassPage />);
    expect(screen.getByText('No grants found')).toBeTruthy();
  });

  it('shows the error state when the grants query fails', () => {
    mocks.grants.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<BreakGlassPage />);
    expect(screen.getByText('Could not load break-glass grants.')).toBeTruthy();
  });

  it('opens the request modal with the grantee defaulted to the current user', () => {
    render(<BreakGlassPage />);
    fireEvent.click(screen.getByRole('button', { name: /request grant/i }));
    const dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByLabelText(/grantee user id/i) as HTMLInputElement).value).toBe('me-uuid');
    expect(dialog.getByLabelText(/approver user id/i)).toBeTruthy();
    expect(dialog.getByLabelText(/reason/i)).toBeTruthy();
  });

  it('blocks the request submit and shows inline validation errors for empty required fields', async () => {
    render(<BreakGlassPage />);
    fireEvent.click(screen.getByRole('button', { name: /request grant/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: /request grant/i }));

    const alerts = await dialog.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rejects a request whose window exceeds the max and never calls the API', async () => {
    render(<BreakGlassPage />);
    fireEvent.click(screen.getByRole('button', { name: /request grant/i }));
    const dialog = within(screen.getByRole('dialog'));

    fireEvent.input(dialog.getByLabelText(/approver user id/i), { target: { value: APPROVER } });
    fireEvent.change(dialog.getByRole('combobox', { name: /scope/i }), { target: { value: 'all' } });
    fireEvent.input(dialog.getByLabelText(/reason/i), { target: { value: 'emergency' } });
    // 100h window > 48h cap
    fireEvent.input(dialog.getByLabelText(/valid from/i), { target: { value: '2026-06-16T09:00' } });
    fireEvent.input(dialog.getByLabelText(/valid until/i), { target: { value: '2026-06-20T13:00' } });

    fireEvent.click(dialog.getByRole('button', { name: /request grant/i }));

    expect(await dialog.findByText(/must not exceed 48 hours/i)).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('submits a valid request (grant-to-other) with an ISO window', async () => {
    mocks.request.mockResolvedValue({ grantId: 'g9', status: 'pending', approverId: APPROVER, updatedAt: '' });
    render(<BreakGlassPage />);
    fireEvent.click(screen.getByRole('button', { name: /request grant/i }));
    const dialog = within(screen.getByRole('dialog'));

    fireEvent.input(dialog.getByLabelText(/grantee user id/i), { target: { value: GRANTEE } });
    fireEvent.input(dialog.getByLabelText(/approver user id/i), { target: { value: APPROVER } });
    fireEvent.change(dialog.getByRole('combobox', { name: /scope/i }), { target: { value: 'all' } });
    fireEvent.input(dialog.getByLabelText(/reason/i), { target: { value: 'emergency access' } });
    fireEvent.input(dialog.getByLabelText(/valid from/i), { target: { value: '2026-06-16T09:00' } });
    fireEvent.input(dialog.getByLabelText(/valid until/i), { target: { value: '2026-06-16T11:00' } });

    fireEvent.click(dialog.getByRole('button', { name: /request grant/i }));

    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    const body = mocks.request.mock.calls[0][0];
    expect(body.granteeId).toBe(GRANTEE);
    expect(body.approverId).toBe(APPROVER);
    expect(body.scopeType).toBe('all');
    expect(body.reason).toBe('emergency access');
    // datetime-local values are normalised to full ISO-8601.
    expect(body.validFrom).toMatch(/Z$/);
    expect(body.validUntil).toMatch(/Z$/);
    // scopeRef is omitted for org-wide scope.
    expect(body.scopeRef).toBeUndefined();
  });

  it('approves a pending grant via the confirm dialog', async () => {
    mocks.approve.mockResolvedValue({ grantId: 'g1', status: 'active', approverId: 'me-uuid', updatedAt: '' });
    render(<BreakGlassPage />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: /approve grant/i }));

    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith('g1'));
  });

  it('surfaces FORBIDDEN (four-eyes) inline when approving fails', async () => {
    mocks.approve.mockRejectedValue(apiError('FORBIDDEN', 403));
    render(<BreakGlassPage />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: /approve grant/i }));

    const alert = await dialog.findByRole('alert');
    expect(alert.textContent).toMatch(/approver must differ from the grantee/i);
    // The dialog stays open so the user sees why.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('revokes an active grant via the confirm dialog', async () => {
    mocks.grants.mockReturnValue(listResult([grant({ status: 'active' })]));
    mocks.revoke.mockResolvedValue({ grantId: 'g1', status: 'revoked', approverId: APPROVER, updatedAt: '' });
    render(<BreakGlassPage />);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: /revoke grant/i }));

    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('g1'));
  });

  it('offers no approve action on a non-pending grant but still allows revoke when active', () => {
    mocks.grants.mockReturnValue(listResult([grant({ status: 'active' })]));
    render(<BreakGlassPage />);
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^revoke$/i })).toBeTruthy();
  });

  it('offers neither approve nor revoke on a terminal (revoked) grant', () => {
    mocks.grants.mockReturnValue(listResult([grant({ status: 'revoked' })]));
    render(<BreakGlassPage />);
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^revoke$/i })).toBeNull();
  });
});
