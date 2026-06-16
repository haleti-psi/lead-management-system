// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApiClientError } from '@/lib/api';
import type { RollbackConfigResult } from '@/types/config-governance';

const mocks = vi.hoisted(() => ({
  rollback: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/hooks/use-config-governance', () => ({
  useApproveConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRollbackConfig: () => ({ mutateAsync: mocks.rollback, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }));

import { RollbackConfirmDialog } from './RollbackConfirmDialog';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';

function rollbackResult(overrides: Partial<RollbackConfigResult> = {}): RollbackConfigResult {
  return {
    rolledBackVersionId: VERSION_ID,
    restoredVersionId: 'prev-version-1',
    configType: 'sla_policy',
    status: 'rolled_back',
    ...overrides,
  };
}

function apiError(code: string, status: number): ApiClientError {
  return new ApiClientError({ code: code as never, message: `${code} message`, status, retryable: false });
}

describe('RollbackConfirmDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a reason before it will submit', () => {
    render(<RollbackConfirmDialog versionId={VERSION_ID} onClose={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: /^roll back$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it('rolls back with the trimmed reason and reports the restored version', async () => {
    mocks.rollback.mockResolvedValue(rollbackResult());
    render(<RollbackConfirmDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: '  wrong threshold  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^roll back$/i }));

    await waitFor(() =>
      expect(mocks.rollback).toHaveBeenCalledWith({ versionId: VERSION_ID, body: { reason: 'wrong threshold' } }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Configuration rolled back.');
    expect(screen.getByText(/previously active version has been restored/i)).toBeTruthy();
  });

  it('notes when there was no prior version to restore', async () => {
    mocks.rollback.mockResolvedValue(rollbackResult({ restoredVersionId: null }));
    render(<RollbackConfirmDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'first version' } });
    fireEvent.click(screen.getByRole('button', { name: /^roll back$/i }));

    await waitFor(() => expect(screen.getByText(/no prior version to restore/i)).toBeTruthy());
  });

  it('surfaces the CONFLICT (not active / already rolled back) error in-dialog', async () => {
    mocks.rollback.mockRejectedValue(apiError('CONFLICT', 409));
    render(<RollbackConfirmDialog versionId={VERSION_ID} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'stale' } });
    fireEvent.click(screen.getByRole('button', { name: /^roll back$/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/already been acted on/i)).toBeTruthy();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
