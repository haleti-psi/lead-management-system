// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { PendingConfigVersion } from '@/types/config-governance';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn(),
  rollback: vi.fn(),
  can: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/hooks/use-config-governance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-config-governance')>();
  return {
    ...actual,
    useConfigVersions: () => mocks.list(),
    useApproveConfig: () => ({ mutateAsync: mocks.approve, isPending: false }),
    useRollbackConfig: () => ({ mutateAsync: mocks.rollback, isPending: false }),
  };
});
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConfigGovernancePage } from './ConfigGovernancePage';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';

function pending(overrides: Partial<PendingConfigVersion> = {}): PendingConfigVersion {
  return {
    configurationVersionId: VERSION_ID,
    makerId: 'maker-1',
    configType: 'sla_policy',
    configRef: 'first-response',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00Z',
    diff: { threshold_minutes: { before: 30, after: 45 } },
    ...overrides,
  };
}

/** A list-query result that returns `rows` by default. */
function listResult(rows: PendingConfigVersion[], extra: Record<string, unknown> = {}) {
  return {
    data: { data: rows, pagination: { page: 1, limit: 25, total: rows.length } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  };
}

describe('ConfigGovernancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
    mocks.list.mockReturnValue(listResult([pending()]));
  });

  it('shows a no-access message and no queue without the configuration capability', () => {
    mocks.can.mockReturnValue(false);
    render(<ConfigGovernancePage />);
    expect(screen.getByText(/don't have access to configuration governance/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve \/ reject/i })).toBeNull();
  });

  it('renders the pending queue rows from GET /admin/config', () => {
    render(<ConfigGovernancePage />);
    expect(screen.getByRole('heading', { name: 'Configuration Approvals' })).toBeTruthy();
    // config_type (humanized), config_ref, maker, status chip.
    expect(screen.getByText('Sla policy')).toBeTruthy();
    expect(screen.getByText('first-response')).toBeTruthy();
    expect(screen.getByText('maker-1')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('opens the review dialog from a row action', () => {
    render(<ConfigGovernancePage />);
    fireEvent.click(screen.getByRole('button', { name: /approve \/ reject/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Review configuration change')).toBeTruthy();
    expect(within(dialog).getByLabelText(/approve/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/reject/i)).toBeTruthy();
  });

  it('refetches the queue after a review dialog closes', () => {
    render(<ConfigGovernancePage />);
    fireEvent.click(screen.getByRole('button', { name: /approve \/ reject/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['admin-config'] });
  });

  it('shows the row diff in a modal from the View action', () => {
    render(<ConfigGovernancePage />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Configuration change details' })).toBeTruthy();
    // The opaque diff is rendered without a further fetch.
    expect(within(dialog).getByText('threshold_minutes')).toBeTruthy();
    expect(within(dialog).getByText('45')).toBeTruthy();
  });

  it('opens the rollback dialog from a row action', () => {
    render(<ConfigGovernancePage />);
    fireEvent.click(screen.getByRole('button', { name: /roll back/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Roll back configuration')).toBeTruthy();
    expect(within(dialog).getByLabelText(/reason/i)).toBeTruthy();
  });

  it('renders the empty state when there are no pending changes', () => {
    mocks.list.mockReturnValue(listResult([]));
    render(<ConfigGovernancePage />);
    expect(screen.getByText('No pending changes')).toBeTruthy();
  });

  it('renders the error state with a retry when the queue query fails', () => {
    const refetch = vi.fn();
    mocks.list.mockReturnValue(listResult([], { isError: true, data: undefined, refetch }));
    render(<ConfigGovernancePage />);
    expect(screen.getByText('Could not load pending configuration changes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
