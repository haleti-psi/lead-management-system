// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type {
  BranchView,
  BusinessCalendarView,
  RegionView,
  RejectionReasonView,
} from '@/types/master-data';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/hooks/use-master-data', () => ({
  useMasterList: (slug: string) => mocks.list(slug),
  useCreateMaster: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateMaster: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MasterDataPage } from './MasterDataPage';

function region(overrides: Partial<RegionView> = {}): RegionView {
  return {
    id: 'reg-1',
    regionId: 'reg-1',
    code: 'WEST',
    name: 'Western Region',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
function branch(overrides: Partial<BranchView> = {}): BranchView {
  return {
    id: 'br-1',
    branchId: 'br-1',
    code: 'MUM-01',
    name: 'Mumbai Central',
    regionId: 'reg-1',
    pinCodes: ['400001'],
    address: 'MG Road',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
function reason(overrides: Partial<RejectionReasonView> = {}): RejectionReasonView {
  return {
    id: 'rr-1',
    rejectionReasonId: 'rr-1',
    primaryReason: 'no_response',
    subReason: 'unreachable',
    requiresRemarks: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
function calendar(overrides: Partial<BusinessCalendarView> = {}): BusinessCalendarView {
  return {
    id: 'bc-1',
    businessCalendarId: 'bc-1',
    code: 'IN-STD',
    name: 'India Standard',
    timezone: 'Asia/Kolkata',
    branchId: null,
    regionId: null,
    workingHours: {
      mon: { start: '09:30', end: '18:00' },
      tue: { start: '09:30', end: '18:00' },
      wed: { start: '09:30', end: '18:00' },
      thu: { start: '09:30', end: '18:00' },
      fri: { start: '09:30', end: '18:00' },
      sat: null,
      sun: null,
    },
    holidays: [],
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** A list-query result that returns `rows` for every resource by default. */
function listResult(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    data: { data: rows, pagination: { page: 1, limit: 25, total: rows.length } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  };
}

describe('MasterDataPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
    // Default: regions resource has one row; the branch form's regions sub-query
    // also flows through this mock.
    mocks.list.mockReturnValue(listResult([region()]));
  });

  it('renders the selected resource rows (regions by default)', () => {
    render(<MasterDataPage />);
    expect(screen.getByRole('heading', { name: 'Master Data' })).toBeTruthy();
    expect(screen.getByText('WEST')).toBeTruthy();
    expect(screen.getByText('Western Region')).toBeTruthy();
    // Regions have no activeness → no status filter, no Deactivate action.
    expect(screen.queryByLabelText('Filter by status')).toBeNull();
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull();
  });

  it('switches resources via the selector and lists the new resource', () => {
    // regions first, then rejection-reasons after the switch.
    mocks.list.mockImplementation((slug: string) =>
      slug === 'rejection-reasons' ? listResult([reason()]) : listResult([region()]),
    );
    render(<MasterDataPage />);
    expect(screen.getByText('Western Region')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Rejection Reasons' }));

    expect(screen.getByText('No response')).toBeTruthy(); // humanized enum
    expect(screen.getByText('unreachable')).toBeTruthy();
    // rejection-reasons have an is_active column → status filter + chip appear.
    expect(screen.getByLabelText('Filter by status')).toBeTruthy();
    // The row's status chip ("Active") is present (the filter also has an
    // "Active" option, so there is more than one match).
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
  });

  it('opens the create modal with resource-specific fields', () => {
    render(<MasterDataPage />);
    fireEvent.click(screen.getByRole('button', { name: /add region/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/code/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/name/i)).toBeTruthy();
  });

  it('shows inline validation errors and does not submit when required fields are empty', async () => {
    render(<MasterDataPage />);
    fireEvent.click(screen.getByRole('button', { name: /add region/i }));
    fireEvent.click(screen.getByRole('button', { name: /create region/i }));

    await waitFor(() => expect(screen.getByText('code is required.')).toBeTruthy());
    expect(screen.getByText('name is required.')).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('renders the empty state when there are no records', () => {
    mocks.list.mockReturnValue(listResult([]));
    render(<MasterDataPage />);
    expect(screen.getByText('No regions found')).toBeTruthy();
  });

  it('renders the error state with a retry when the list query fails', () => {
    const refetch = vi.fn();
    mocks.list.mockReturnValue(listResult([], { isError: true, data: undefined, refetch }));
    render(<MasterDataPage />);
    expect(screen.getByText('Could not load regions.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows a no-access message and never queries without the configuration capability', () => {
    mocks.can.mockReturnValue(false);
    render(<MasterDataPage />);
    expect(screen.getByText(/don't have access to master configuration/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
  });

  it('offers a Deactivate action only for active rows of activeness resources', () => {
    mocks.list.mockImplementation((slug: string) =>
      slug === 'branches' ? listResult([branch(), branch({ id: 'br-2', code: 'PUN-01', isActive: false })]) : listResult([region()]),
    );
    render(<MasterDataPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Branches' }));
    // Two rows: the active one has a Deactivate button, the inactive one does not.
    expect(screen.getAllByRole('button', { name: /deactivate/i })).toHaveLength(1);
  });

  it('lists business calendars with timezone', () => {
    mocks.list.mockImplementation((slug: string) =>
      slug === 'business-calendars' ? listResult([calendar()]) : listResult([region()]),
    );
    render(<MasterDataPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Business Calendars' }));
    expect(screen.getByText('IN-STD')).toBeTruthy();
    expect(screen.getByText('Asia/Kolkata')).toBeTruthy();
  });
});
