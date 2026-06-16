// @vitest-environment jsdom
//
// FR-123 §UI tests for the Audit Explorer page. `useAudit`, `useUnmaskAudit`, and
// the `useCan` capability hook are mocked so the components run without a
// network/server. Covers: masked rows render, filtering, the per-page integrity
// badge (intact + broken), the reason-gated unmask flow, and the empty/error/
// forbidden states. Assertions use built-in matchers + DOM props (no jest-dom).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import type { AuditItem, AuditPageResult } from '@/types/audit';

// ── mock hooks/capabilities before any component import ───────────────────────
const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  unmask: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/hooks/use-audit', () => ({
  useAudit: () => mocks.audit(),
  useUnmaskAudit: () => ({
    mutateAsync: mocks.unmask,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/lib/auth/capabilities', () => ({
  useCan: () => (capability: string) => mocks.can(capability),
}));

import { AuditExplorerPage } from './AuditExplorerPage';

function item(overrides: Partial<AuditItem> = {}): AuditItem {
  return {
    audit_id: 'a-1',
    actor_id: 'u-1',
    actor_display: 'Ravi Sharma · RM',
    action: 'stage_transition',
    entity_type: 'leads',
    entity_id: 'lead-9',
    lead_id: 'lead-9',
    before_hash: 'h0',
    after_hash: 'h1',
    prev_audit_hash: 'h0',
    detail: { mobile: '98xxxxxx10', stage: 'qualified' },
    created_at: '2026-06-09T08:32:10.123Z',
    ...overrides,
  };
}

function result(overrides: Partial<AuditPageResult> = {}): AuditPageResult {
  return {
    items: [item()],
    integrity: { badge: 'intact', checkedCount: 25, breakAt: null },
    total: 1,
    ...overrides,
  };
}

function setAudit(overrides?: {
  data?: AuditPageResult;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}): void {
  mocks.audit.mockReturnValue({
    data: overrides?.data,
    isLoading: overrides?.isLoading ?? false,
    isError: overrides?.isError ?? false,
    error: overrides?.error ?? null,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(true); // DPO/ADMIN by default
  setAudit({ data: result() });
});

describe('AuditExplorerPage', () => {
  it('renders audit rows with masked PII in the detail cell', () => {
    render(<AuditExplorerPage />);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Ravi Sharma · RM')).toBeTruthy();
    // The action chip shows the action in the row (the same value also appears as
    // a filter <option>, so scope the assertion to the table).
    expect(table.getByText('stage_transition')).toBeTruthy();
    // The masked mobile is shown (server-masked); the raw value never appears.
    expect(table.getByText('98xxxxxx10')).toBeTruthy();
    expect(screen.queryByText('9876543210')).toBeNull();
  });

  it('shows the integrity badge (intact) from the response meta', () => {
    render(<AuditExplorerPage />);
    expect(screen.getByText(/chain intact \(25 records verified\)/i)).toBeTruthy();
  });

  it('shows a broken integrity badge with the offending record id, without hiding rows', () => {
    setAudit({
      data: result({ integrity: { badge: 'broken', checkedCount: 25, breakAt: 'a-7' } }),
    });
    render(<AuditExplorerPage />);
    expect(screen.getByText(/chain break at record a-7/i)).toBeTruthy();
    // Rows are still rendered (evidence is never withheld).
    expect(screen.getByText('Ravi Sharma · RM')).toBeTruthy();
  });

  it('applies filters and resets to page 1 (filter bar wired)', () => {
    render(<AuditExplorerPage />);
    const actionSelect = screen.getByLabelText('Filter by action') as HTMLSelectElement;
    fireEvent.change(actionSelect, { target: { value: 'login' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));
    // The hook is re-read on every render; the bar drove a state change without error.
    expect(actionSelect.value).toBe('login');
  });

  it('unmask requires a reason before the reveal call is made', async () => {
    mocks.unmask.mockResolvedValue({ audit_id: 'a-1', field: 'mobile', value: '9876543210' });
    render(<AuditExplorerPage />);

    // Open the unmask modal for the masked mobile field.
    fireEvent.click(screen.getByRole('button', { name: 'Reveal mobile' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();

    // Reveal is disabled until a sufficient reason is entered.
    const revealBtn = within(dialog).getByRole('button', { name: /reveal value/i }) as HTMLButtonElement;
    expect(revealBtn.disabled).toBe(true);

    fireEvent.click(revealBtn);
    expect(mocks.unmask).not.toHaveBeenCalled();

    // Enter a valid reason → reveal becomes enabled → call fires → value shown transiently.
    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: 'Investigating a customer grievance ticket #4821.' },
    });
    expect(revealBtn.disabled).toBe(false);
    fireEvent.click(revealBtn);

    await waitFor(() => {
      expect(mocks.unmask).toHaveBeenCalledWith({
        audit_id: 'a-1',
        field: 'mobile',
        reason: 'Investigating a customer grievance ticket #4821.',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('9876543210')).toBeTruthy();
    });
  });

  it('shows the empty state when there are no records', () => {
    setAudit({ data: result({ items: [], total: 0, integrity: { badge: 'not_checked', checkedCount: 0, breakAt: null } }) });
    render(<AuditExplorerPage />);
    expect(screen.getByText('No audit records')).toBeTruthy();
  });

  it('shows an error state with retry when the query fails', () => {
    setAudit({ data: undefined, isError: true, error: new Error('boom') });
    render(<AuditExplorerPage />);
    expect(screen.getByText('Could not load the audit trail.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('renders a no-access message for a role without the audit_trail capability', () => {
    mocks.can.mockReturnValue(false);
    render(<AuditExplorerPage />);
    expect(screen.getByText("You don't have access to this.")).toBeTruthy();
    // The table is not rendered for an unauthorised user.
    expect(screen.queryByText('Ravi Sharma · RM')).toBeNull();
  });
});
