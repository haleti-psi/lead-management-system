// @vitest-environment jsdom
/**
 * FR-114 — Web component unit tests.
 * T40: GrievanceResolutionForm shows only valid next statuses for each current status.
 * Additional: ConfirmDialog shown before closing; closed grievance shows read-only message.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { GrievanceResolutionForm, StatusSelect } from './GrievanceResolutionForm';
import type { GrievanceItem, GrievanceStatus } from './grievance.types';
import { VALID_NEXT_STATUSES } from './grievance.types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseGrievance(overrides: Partial<GrievanceItem> = {}): GrievanceItem {
  return {
    grievanceId: 'gv-001',
    grievanceNo: 'GRV-2026-000001',
    leadId: null,
    source: 'rm',
    category: 'service_delay',
    description: 'Test grievance description that is long enough.',
    ownerId: null,
    slaDueAt: null,
    status: 'open',
    response: null,
    closureProofRef: null,
    createdAt: '2026-06-14T09:00:00Z',
    updatedAt: '2026-06-14T09:00:00Z',
    createdBy: 'user-001',
    ...overrides,
  };
}

/** Wrap StatusSelect in an RHF FormProvider (it calls useFormContext internally). */
function StatusSelectHarness({
  currentStatus,
  validNextStatuses,
}: {
  currentStatus: GrievanceStatus;
  validNextStatuses: GrievanceStatus[];
}): ReactNode {
  const form = useForm({ defaultValues: { status: '' } });
  return (
    <FormProvider {...form}>
      <StatusSelect currentStatus={currentStatus} validNextStatuses={validNextStatuses} />
    </FormProvider>
  );
}

// ── T40: StatusSelect shows only valid next statuses ─────────────────────────

describe('T40: StatusSelect — only valid next statuses shown', () => {
  const cases: Array<{ status: GrievanceStatus; expectedOptions: GrievanceStatus[]; absentOptions: GrievanceStatus[] }> = [
    {
      status: 'open',
      expectedOptions: ['in_progress'],
      absentOptions: ['escalated', 'resolved', 'closed'],
    },
    {
      status: 'in_progress',
      expectedOptions: ['escalated', 'resolved'],
      absentOptions: ['open', 'closed'],
    },
    {
      status: 'escalated',
      expectedOptions: ['resolved'],
      absentOptions: ['open', 'in_progress', 'closed'],
    },
    {
      status: 'resolved',
      expectedOptions: ['closed'],
      absentOptions: ['open', 'in_progress', 'escalated'],
    },
    {
      status: 'closed',
      expectedOptions: [],
      absentOptions: ['open', 'in_progress', 'escalated', 'resolved'],
    },
  ];

  for (const { status, expectedOptions, absentOptions } of cases) {
    it(`status=${status}: shows [${expectedOptions.join(', ')}] and hides [${absentOptions.join(', ')}]`, () => {
      const validNextStatuses = (VALID_NEXT_STATUSES[status] ?? []) as GrievanceStatus[];
      render(
        <StatusSelectHarness
          currentStatus={status}
          validNextStatuses={validNextStatuses}
        />,
      );

      const select = screen.getByRole('combobox', { name: 'Status' });

      for (const expected of expectedOptions) {
        const option = select.querySelector<HTMLOptionElement>(`option[value="${expected}"]`);
        expect(option, `Expected option "${expected}" to be present for status="${status}"`).not.toBeNull();
      }

      for (const absent of absentOptions) {
        const option = select.querySelector<HTMLOptionElement>(`option[value="${absent}"]`);
        expect(option, `Expected option "${absent}" to be absent for status="${status}"`).toBeNull();
      }
    });
  }
});

// ── GrievanceResolutionForm: closed grievance shows read-only message ─────────

describe('GrievanceResolutionForm', () => {
  it('shows a read-only message when grievance is closed', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GrievanceResolutionForm
        grievance={baseGrievance({ status: 'closed' })}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText(/This grievance is closed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save/i })).toBeNull();
  });

  it('shows Save button and status select for non-closed grievance', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GrievanceResolutionForm
        grievance={baseGrievance({ status: 'open' })}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('button', { name: /Save/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
  });

  it('shows ConfirmDialog when user submits status=closed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GrievanceResolutionForm
        grievance={baseGrievance({ status: 'resolved', closureProofRef: null, response: 'done' })}
        onSubmit={onSubmit}
      />,
    );

    // Select "closed"
    const select = screen.getByRole('combobox', { name: 'Status' });
    fireEvent.change(select, { target: { value: 'closed' } });

    // Fill closureProofRef
    const proofInput = screen.getByLabelText(/Closure proof reference/i);
    fireEvent.change(proofInput, { target: { value: 'gcs://bucket/proof.pdf' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    // Wait for the ConfirmDialog to appear
    await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { name: /Close grievance\?/i })).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit after confirming the close dialog', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GrievanceResolutionForm
        grievance={baseGrievance({ status: 'resolved', response: 'done', closureProofRef: null })}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
      target: { value: 'closed' },
    });
    fireEvent.change(screen.getByLabelText(/Closure proof reference/i), {
      target: { value: 'gcs://bucket/proof.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Confirm close/i }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed', closureProofRef: 'gcs://bucket/proof.pdf' }),
    );
  });
});
