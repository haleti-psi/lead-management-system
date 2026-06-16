// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RoleCode, DataScope } from '@lms/shared';
import type { LeadListItem } from '@/types/lead';

const mocks = vi.hoisted(() => ({
  leads: vi.fn(),
  savedViews: vi.fn(),
  createView: vi.fn(),
  user: { userId: 'u-1', orgId: 'o-1', role: 'BM' as RoleCode, scope: 'B' as DataScope },
}));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: mocks.user, logout: vi.fn() }) }));
vi.mock('@/hooks/use-leads', () => ({
  useLeads: (params: unknown) => mocks.leads(params),
  useSavedViews: () => mocks.savedViews(),
  useCreateSavedView: () => ({ mutate: mocks.createView, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeadListPage } from './LeadListPage';

function lead(overrides: Partial<LeadListItem> = {}): LeadListItem {
  return {
    lead_id: 'l1',
    lead_code: 'LD-2026-000123',
    stage: 'documents_pending',
    product_code: 'CV',
    is_hot: true,
    score: 78,
    consent_status: 'captured',
    kyc_status: 'in_progress',
    name_masked: 'Ra***** K****',
    mobile_masked: '98xxxxxx10',
    ...overrides,
  };
}

function leadsResult(rows: LeadListItem[], total = rows.length) {
  return {
    data: { data: rows, pagination: { page: 1, limit: 25, total } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function renderAt(initialEntry = '/leads'): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LeadListPage />
    </MemoryRouter>,
  );
}

describe('LeadListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { userId: 'u-1', orgId: 'o-1', role: 'BM', scope: 'B' };
    mocks.savedViews.mockReturnValue({ data: { data: [], pagination: { page: 1, limit: 100, total: 0 } } });
  });

  it('renders masked lead rows with stage chip and score', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    renderAt();
    const table = screen.getByRole('table');
    expect(screen.getByRole('link', { name: 'LD-2026-000123' })).toBeTruthy();
    expect(screen.getByText('Ra***** K****')).toBeTruthy();
    expect(screen.getByText('98xxxxxx10')).toBeTruthy();
    // "Documents pending" also appears as a Stage filter <option>; assert the
    // row's StatusChip specifically.
    expect(within(table).getByText('Documents pending')).toBeTruthy();
    expect(within(table).getByText('78')).toBeTruthy();
  });

  it('links each row to its lead-360 detail route', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    renderAt();
    expect(screen.getByRole('link', { name: 'LD-2026-000123' }).getAttribute('href')).toBe('/leads/l1');
  });

  it('submits a free-text search into the query (≥2 chars)', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    renderAt();
    fireEvent.change(screen.getByRole('searchbox', { name: /search leads/i }), {
      target: { value: 'Ramesh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    // The hook is re-invoked with the q param applied.
    const lastCall = mocks.leads.mock.calls.at(-1)?.[0] as { q?: string };
    expect(lastCall.q).toBe('Ramesh');
  });

  it('applies a stage column filter to the query', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    renderAt();
    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'qualified' } });
    const lastCall = mocks.leads.mock.calls.at(-1)?.[0] as { filters: { stage?: string } };
    expect(lastCall.filters.stage).toBe('qualified');
  });

  it('reads filters from the URL query (dashboard drill-through)', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    renderAt('/leads?filter[is_hot]=true');
    const firstCall = mocks.leads.mock.calls.at(-1)?.[0] as { filters: { is_hot?: boolean } };
    expect(firstCall.filters.is_hot).toBe(true);
  });

  it('applies a built-in saved-view queue chip', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Hot' }));
    const lastCall = mocks.leads.mock.calls.at(-1)?.[0] as { filters: { is_hot?: boolean } };
    expect(lastCall.filters.is_hot).toBe(true);
  });

  it('lists user saved views as chips and applies their filter_json', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    mocks.savedViews.mockReturnValue({
      data: {
        data: [
          {
            saved_view_id: 'sv1',
            name: 'Hot CV North',
            filter_json: { product_code: 'CV', is_hot: true },
            is_shared: true,
            scope: 'B',
            owner_id: 'u-1',
            created_at: '2026-06-09T00:00:00Z',
            updated_at: '2026-06-09T00:00:00Z',
          },
        ],
        pagination: { page: 1, limit: 100, total: 1 },
      },
    });
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Hot CV North' }));
    const lastCall = mocks.leads.mock.calls.at(-1)?.[0] as { filters: { product_code?: string } };
    expect(lastCall.filters.product_code).toBe('CV');
  });

  it('paginates via the DataTable Next control', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()], 60));
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // The leads hook is re-invoked; the page change is reflected in the table footer.
    expect(screen.getByText(/Showing/)).toBeTruthy();
  });

  it('shows the empty state when no leads match', () => {
    mocks.leads.mockReturnValue(leadsResult([], 0));
    renderAt();
    expect(screen.getByText('No leads match this queue')).toBeTruthy();
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mocks.leads.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.getByText('Could not load leads.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('opens the save-view modal and creates a view', () => {
    mocks.leads.mockReturnValue(leadsResult([lead()]));
    renderAt('/leads?filter[stage]=qualified');
    fireEvent.click(screen.getByRole('button', { name: /save current view/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/view name/i), { target: { value: 'My queue' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save view/i }));
    expect(mocks.createView).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My queue', filter_json: expect.objectContaining({ stage: 'qualified' }) }),
      expect.anything(),
    );
  });

  it('hides the lead list for a role without view_lead', () => {
    mocks.user = { userId: 'u-1', orgId: 'o-1', role: 'ADMIN', scope: 'X' };
    mocks.leads.mockReturnValue(leadsResult([]));
    renderAt();
    expect(screen.getByText(/don't have access to the lead list/i)).toBeTruthy();
  });
});
