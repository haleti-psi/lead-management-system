// @vitest-environment jsdom
//
// FR-120 §UI tests (U-01 – U-06) for ReportsPage, ReportFilterBar, ReportViewer.
// `useReport` and `useAuth` are mocked so components run without a network/server.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── mock hooks before any component import ────────────────────────────────────
vi.mock('@/hooks/use-report', () => ({
  useReport: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useReport } from '@/hooks/use-report';
import { useAuth } from '@/hooks/use-auth';
import { ReportsPage } from './ReportsPage';
import { ReportFilterBar } from './ReportFilterBar';
import { ReportViewer } from './ReportViewer';
import type { ReportData } from '@/lib/api/reports';

const mockUseReport = useReport as ReturnType<typeof vi.fn>;
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

function setupAuth(role = 'HEAD'): void {
  mockUseAuth.mockReturnValue({
    user: { userId: 'u1', orgId: 'org-1', role, scope: 'A' },
    isLoading: false,
  });
}

function setupReport(overrides?: {
  data?: ReportData;
  isLoading?: boolean;
  isError?: boolean;
  errorCode?: string | null;
}): void {
  mockUseReport.mockReturnValue({
    data: overrides?.data,
    total: 0,
    isLoading: overrides?.isLoading ?? false,
    isError: overrides?.isError ?? false,
    errorCode: overrides?.errorCode ?? null,
    refetch: vi.fn(),
  });
}

function makeFunnelData(): ReportData {
  return {
    report_code: 'funnel_conversion',
    generated_at: '2026-06-09T12:34:56.789+05:30',
    scope: { branch_id: null, team_id: null, owner_id: null },
    period: { from: '2026-05-01', to: '2026-05-31' },
    rows: [
      {
        dimension: 'CV',
        captured: 210,
        assigned: 190,
        contacted: 175,
        qualified: 138,
        documents_pending: 110,
        kyc_in_progress: 93,
        handed_off: 64,
        rejected: 28,
        active_pipeline: 118,
        overall_conversion_pct: '30.5',
        kyc_conversion_pct: '68.8',
      },
    ],
  };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth('HEAD');
  setupReport({ data: makeFunnelData() });
});

// ── U-01: HEAD sees all filter controls ─────────────────────────────────────

describe('U-01: ReportFilterBar — HEAD role', () => {
  it('renders branch, team, owner, source selects for HEAD', () => {
    render(
      <ReportFilterBar
        code="funnel_conversion"
        userRole="HEAD"
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Filter by branch')).toBeDefined();
    expect(screen.getByLabelText('Filter by team')).toBeDefined();
    expect(screen.getByLabelText('Filter by owner')).toBeDefined();
  });
});

// ── U-02: RM sees no branch/team/owner selects ───────────────────────────────

describe('U-02: ReportFilterBar — RM role', () => {
  it('does not render BranchSelect, TeamSelect, OwnerSelect for RM', () => {
    render(
      <ReportFilterBar
        code="funnel_conversion"
        userRole="RM"
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Filter by branch')).toBeNull();
    expect(screen.queryByLabelText('Filter by team')).toBeNull();
    expect(screen.queryByLabelText('Filter by owner')).toBeNull();
  });
});

// ── U-03: zero-denominator cell renders literal "–" ─────────────────────────

describe('U-03: ReportViewer — zero-denominator cell', () => {
  it('renders "–" literally for overall_conversion_pct = "–"', () => {
    const data: ReportData = {
      ...makeFunnelData(),
      rows: [
        {
          dimension: 'TW',
          captured: 0,
          assigned: 0,
          contacted: 0,
          qualified: 0,
          documents_pending: 0,
          kyc_in_progress: 0,
          handed_off: 0,
          rejected: 0,
          active_pipeline: 0,
          overall_conversion_pct: '–',
          kyc_conversion_pct: '–',
        },
      ],
    };
    render(
      <ReportViewer
        code="funnel_conversion"
        data={data}
        isLoading={false}
        isError={false}
        errorCode={null}
      />,
    );
    const cells = screen.getAllByText('–');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });
});

// ── U-04: LoadingSkeleton while query in-flight ──────────────────────────────

describe('U-04: LoadingSkeleton', () => {
  it('shows loading state and hides table while query in-flight', () => {
    render(
      <ReportViewer
        code="funnel_conversion"
        data={undefined}
        isLoading={true}
        isError={false}
        errorCode={null}
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading report' })).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

// ── U-05: EmptyState when rows = [] ─────────────────────────────────────────

describe('U-05: EmptyState', () => {
  it('shows empty state when rows is empty', () => {
    const emptyData: ReportData = { ...makeFunnelData(), rows: [] };
    render(
      <ReportViewer
        code="funnel_conversion"
        data={emptyData}
        isLoading={false}
        isError={false}
        errorCode={null}
      />,
    );
    expect(screen.getByRole('status', { name: 'No report data' })).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

// ── U-06: ErrorState on FORBIDDEN ───────────────────────────────────────────

describe('U-06: ErrorState', () => {
  it('renders error state with FORBIDDEN message', () => {
    render(
      <ReportViewer
        code="funnel_conversion"
        data={undefined}
        isLoading={false}
        isError={true}
        errorCode="FORBIDDEN"
      />,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/do not have permission/i)).toBeDefined();
  });

  it('renders generic error for INTERNAL_ERROR', () => {
    render(
      <ReportViewer
        code="funnel_conversion"
        data={undefined}
        isLoading={false}
        isError={true}
        errorCode="INTERNAL_ERROR"
      />,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/error occurred/i)).toBeDefined();
  });
});

// ── ReportsPage smoke tests ──────────────────────────────────────────────────

describe('ReportsPage', () => {
  it('renders report selector tabs', () => {
    setupReport({ data: makeFunnelData() });
    renderPage();
    expect(screen.getByRole('tab', { name: 'Funnel / Conversion' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Source Performance' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'RM / Team Performance' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Rejection Summary' })).toBeDefined();
  });

  it('renders the data table when rows are present', () => {
    setupReport({ data: makeFunnelData() });
    renderPage();
    expect(screen.getByRole('table')).toBeDefined();
  });

  it('Apply button triggers onApply callback', () => {
    const onApply = vi.fn();
    render(
      <ReportFilterBar code="funnel_conversion" userRole="HEAD" onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply report filters' }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});

// ── FR-121: differentiator report tabs present ───────────────────────────────

describe('FR-121 — ReportsPage: differentiator report tabs', () => {
  it('renders First Contact SLA tab', () => {
    setupReport({ data: makeFunnelData() });
    renderPage();
    expect(screen.getByRole('tab', { name: 'First Contact SLA' })).toBeDefined();
  });

  it('renders DSA / Dealer Quality tab', () => {
    setupReport({ data: makeFunnelData() });
    renderPage();
    expect(screen.getByRole('tab', { name: 'DSA / Dealer Quality' })).toBeDefined();
  });

  it('renders Consent & Privacy Ops tab', () => {
    setupReport({ data: makeFunnelData() });
    renderPage();
    expect(screen.getByRole('tab', { name: 'Consent & Privacy Ops' })).toBeDefined();
  });

  it('renders RM Capacity & Load tab', () => {
    setupReport({ data: makeFunnelData() });
    renderPage();
    expect(screen.getByRole('tab', { name: 'RM Capacity & Load' })).toBeDefined();
  });
});

// ── FR-121: ReportViewer renders differentiator columns ──────────────────────

describe('FR-121 — ReportViewer: differentiator columns', () => {
  it('U04: first_contact_sla — zero-denominator compliance_pct "–" renders as "–"', () => {
    const data: ReportData = {
      report_code: 'first_contact_sla',
      generated_at: '2026-06-09T12:00:00+05:30',
      scope: { branch_id: null, team_id: null, owner_id: null },
      period: { from: null, to: null },
      rows: [{
        branch_id: 'b1',
        branch_name: 'Mumbai Central',
        total: 5,
        contacted: 0,
        breached: 0,
        compliance_pct: '–',
      }] as ReportData['rows'],
    };
    render(
      <ReportViewer
        code="first_contact_sla"
        data={data}
        isLoading={false}
        isError={false}
        errorCode={null}
      />,
    );
    const dashCells = screen.getAllByText('–');
    expect(dashCells.length).toBeGreaterThanOrEqual(1);
  });

  it('source_roi — renders cost_data_available=false row (conversion_rate_pct "–")', () => {
    const data: ReportData = {
      report_code: 'source_roi',
      generated_at: '2026-06-09T12:00:00+05:30',
      scope: { branch_id: null, team_id: null, owner_id: null },
      period: { from: null, to: null },
      rows: [{
        source: 'dsa',
        campaign_code: null,
        partner_id: null,
        total_leads: 0,
        converted: 0,
        rejected: 0,
        conversion_rate_pct: '–',
        cost_data_available: false,
      }] as ReportData['rows'],
    };
    render(
      <ReportViewer
        code="source_roi"
        data={data}
        isLoading={false}
        isError={false}
        errorCode={null}
      />,
    );
    // scope to the detail table — the source label also appears in the new chart
    expect(within(screen.getByRole('table')).getByText('dsa')).toBeDefined();
    expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(1);
  });

  it('U01: LoadingSkeleton shown when isLoading=true for differentiator report', () => {
    render(
      <ReportViewer
        code="rm_capacity_load"
        data={undefined}
        isLoading={true}
        isError={false}
        errorCode={null}
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading report' })).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('U02: EmptyState shown when rows=[] for differentiator report', () => {
    const data: ReportData = {
      report_code: 'contactability',
      generated_at: '2026-06-09T12:00:00+05:30',
      scope: { branch_id: null, team_id: null, owner_id: null },
      period: { from: null, to: null },
      rows: [],
    };
    render(
      <ReportViewer
        code="contactability"
        data={data}
        isLoading={false}
        isError={false}
        errorCode={null}
      />,
    );
    expect(screen.getByRole('status', { name: 'No report data' })).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('U03: ErrorState shown with FORBIDDEN for differentiator report (DPO non-consent)', () => {
    render(
      <ReportViewer
        code="rm_capacity_load"
        data={undefined}
        isLoading={false}
        isError={true}
        errorCode="FORBIDDEN"
      />,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/do not have permission/i)).toBeDefined();
  });
});
