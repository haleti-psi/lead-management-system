// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApiClientError } from '@/lib/api';
import type { ApproveConfigResult } from '@/types/config-governance';

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/hooks/use-config-governance', () => ({
  useApproveConfig: () => ({ mutateAsync: mocks.approve, isPending: false }),
  useRollbackConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }));

import { ApproveConfigDialog } from './ApproveConfigDialog';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';

function approveResult(overrides: Partial<ApproveConfigResult> = {}): ApproveConfigResult {
  return {
    configurationVersionId: VERSION_ID,
    configType: 'sla_policy',
    configRef: null,
    version: 3,
    status: 'active',
    effectiveAt: null,
    makerId: 'maker-1',
    checkerId: 'checker-1',
    diff: { threshold_minutes: { before: 30, after: 45 } },
    ...overrides,
  };
}

function apiError(code: string, status: number): ApiClientError {
  return new ApiClientError({ code: code as never, message: `${code} message`, status, retryable: false });
}

describe('ApproveConfigDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('approves the change and renders the returned diff', async () => {
    mocks.approve.mockResolvedValue(approveResult());
    render(<ApproveConfigDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /approve change/i }));

    await waitFor(() => expect(screen.getByText('Configuration change reviewed')).toBeTruthy());
    expect(mocks.approve).toHaveBeenCalledWith({ versionId: VERSION_ID, body: { action: 'approved' } });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Configuration approved.');
    // Diff is rendered (field + before/after values).
    expect(screen.getByText('threshold_minutes')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('45')).toBeTruthy();
    // New status chip.
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('rejects the change with the rejected action and an optional comment', async () => {
    mocks.approve.mockResolvedValue(approveResult({ status: 'rejected', diff: null }));
    render(<ApproveConfigDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(/reject/i));
    fireEvent.change(screen.getByLabelText(/comment/i), { target: { value: 'Not approved' } });
    fireEvent.click(screen.getByRole('button', { name: /reject change/i }));

    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        versionId: VERSION_ID,
        body: { action: 'rejected', comment: 'Not approved' },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Configuration rejected.');
  });

  it('surfaces the FORBIDDEN (self-approval / scope) error in-dialog', async () => {
    mocks.approve.mockRejectedValue(apiError('FORBIDDEN', 403));
    render(<ApproveConfigDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /approve change/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/can't approve a change you made/i)).toBeTruthy();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('surfaces the CONFLICT (already acted) error in-dialog', async () => {
    mocks.approve.mockRejectedValue(apiError('CONFLICT', 409));
    render(<ApproveConfigDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /approve change/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/already been acted on/i)).toBeTruthy();
  });

  it('surfaces the NOT_FOUND error in-dialog', async () => {
    mocks.approve.mockRejectedValue(apiError('NOT_FOUND', 404));
    render(<ApproveConfigDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /approve change/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/no pending configuration change was found/i)).toBeTruthy();
  });

  it('shows a friendly message when the approved version has no diff details', async () => {
    mocks.approve.mockResolvedValue(approveResult({ diff: null }));
    render(<ApproveConfigDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /approve change/i }));

    await waitFor(() => expect(screen.getByText(/no change details were recorded/i)).toBeTruthy());
  });
});
