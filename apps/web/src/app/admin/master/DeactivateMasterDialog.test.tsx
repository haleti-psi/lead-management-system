// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiClientError } from '@/lib/api';
import { ERROR_CODES } from '@lms/shared';
import type { BranchView, MasterResourceMeta } from '@/types/master-data';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/hooks/use-master-data', () => ({
  useUpdateMaster: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeactivateMasterDialog } from './DeactivateMasterDialog';

const meta: MasterResourceMeta = {
  slug: 'regions',
  label: 'Regions',
  singular: 'region',
  activeness: 'boolean',
};
const record = { id: 'reg-1', code: 'WEST', isActive: true } as unknown as BranchView;

describe('DeactivateMasterDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('surfaces the in-use CONFLICT reason inline instead of closing', async () => {
    mocks.update.mockRejectedValue(
      new ApiClientError({
        code: ERROR_CODES.CONFLICT,
        message: 'This action conflicts with the current state.',
        status: 409,
        retryable: false,
        detail: { reason: 'Cannot delete region with active branches.' },
      }),
    );
    const onClose = vi.fn();
    render(
      <DeactivateMasterDialog meta={meta} record={record} recordLabel="WEST" onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() =>
      expect(screen.getByText('Cannot delete region with active branches.')).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to a generic in-use message when CONFLICT has no detail reason', async () => {
    mocks.update.mockRejectedValue(
      new ApiClientError({
        code: ERROR_CODES.CONFLICT,
        message: 'Conflict',
        status: 409,
        retryable: false,
      }),
    );
    render(
      <DeactivateMasterDialog meta={meta} record={record} recordLabel="WEST" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/referenced by active records and cannot be deactivated/i),
      ).toBeTruthy(),
    );
  });

  it('deactivates and closes on success (PATCH isActive:false)', async () => {
    mocks.update.mockResolvedValue({ id: 'reg-1', isActive: false });
    const onClose = vi.fn();
    render(
      <DeactivateMasterDialog meta={meta} record={record} recordLabel="WEST" onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith({ id: 'reg-1', body: { isActive: false } });
  });
});
