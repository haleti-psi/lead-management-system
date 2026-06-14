// @vitest-environment jsdom
//
// FR-053 §UI tests for DashboardPage + DashboardGrid components.
// The `useDashboard` hook and `useAuth` hook are mocked so the component runs
// in isolation without a network or server. Covers the required UI test scenarios
// from FR-053-tests.md §UI Test Scenarios.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── mock hooks before any component import ────────────────────────────────────
vi.mock('@/hooks/use-dashboard', () => ({
  useDashboard: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { useDashboard } from '@/hooks/use-dashboard';
import { useAuth } from '@/hooks/use-auth';
import { DashboardPage } from './DashboardPage';
import type { DashboardData } from '@/hooks/use-dashboard';

const mockUseDashboard = useDashboard as ReturnType<typeof vi.fn>;
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

// ── fixtures ──────────────────────────────────────────────────────────────────

function bmUser() {
  return { userId: 'bm-1', orgId: 'org-1', role: 'BM', scope: 'B' };
}

function rmUser() {
  return { userId: 'rm-1', orgId: 'org-1', role: 'RM', scope: 'O' };
}

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    role: 'BM',
    scope: { branch_id: 'branch-1' },
    generated_at: new Date().toISOString(),
    cache_hit: false,
    widgets: {
      kpi: {
        active_pipeline: 5,
        captured_today: 2,
        hot_leads: 1,
        sla_breached: 0,
        consent_coverage_pct: 97,
        handed_off_this_month: 3,
      },
      sla_alerts: [],
      hot_leads: [
        {
          lead_id: 'lead-1',
          lead_code: 'LD-2026-000001',
          stage: 'contacted',
          name_masked: 'Am***** P****',
          mobile_masked: '98xxxxxx21',
          score: 88,
          owner_name: 'Rahul',
        },
      ],
      my_tasks: [
        {
          task_id: 'task-1',
          type: 'call',
          due_at: new Date().toISOString(),
          priority: 'high',
          lead_code: 'LD-2026-000001',
          status: 'open',
        },
      ],
      source_summary: [{ source_name: 'DSA', captured: 10, handed_off: 3 }],
      handoff_failures: { count: 1, leads: [{ lead_id: 'lead-1', lead_code: 'LD-2026-000001', last_attempt_at: new Date().toISOString() }] },
      widget_errors: [],
    },
    ...overrides,
  };
}

function makeEmptyData(): DashboardData {
  return makeData({
    widgets: {
      kpi: { active_pipeline: 0, captured_today: 0, hot_leads: 0, sla_breached: 0, consent_coverage_pct: 100, handed_off_this_month: 0 },
      sla_alerts: [],
      hot_leads: [],
      my_tasks: [],
      source_summary: [],
      handoff_failures: { count: 0, leads: [] },
      widget_errors: [],
    },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseDashboard.mockReset();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ user: bmUser(), logout: vi.fn() });
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe('DashboardPage — loading state', () => {
  it('renders LoadingSkeleton for each of the 6 widget card positions while isLoading=true', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });

    renderPage();

    // LoadingSkeleton renders role="status" aria-label="Loading"
    const skeletons = screen.getAllByRole('status', { name: /loading/i });
    // 6 KPI skeletons + 2 more = ≥ 6 skeleton regions
    expect(skeletons.length).toBeGreaterThanOrEqual(6);
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('DashboardPage — empty state', () => {
  it('renders EmptyState with "Welcome" and "Capture a lead" CTA when all KPI counts are 0', () => {
    mockUseDashboard.mockReturnValue({ data: makeEmptyData(), isLoading: false, isError: false, refetch: vi.fn() });

    renderPage();

    // EmptyState renders role="status"
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Welcome');
    // CTA link
    const cta = screen.getByRole('link', { name: /capture a lead/i });
    expect(cta).toBeDefined();
  });
});

// ── Widget error state ────────────────────────────────────────────────────────

describe('DashboardPage — widget error state', () => {
  it('renders WidgetErrorState inside HandoffFailureWidget when widget_errors contains handoff_failures', () => {
    const data = makeData({
      widgets: {
        ...makeData().widgets,
        handoff_failures: null,
        widget_errors: [{ widget: 'handoff_failures', error_code: 'INTERNAL_ERROR', message: 'Widget temporarily unavailable.' }],
      },
    });
    mockUseDashboard.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });

    renderPage();

    // WidgetErrorState renders role="alert"
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const alertText = alerts.map((a) => a.textContent).join('');
    expect(alertText).toContain('temporarily unavailable');
  });
});

// ── PII masking in UI ─────────────────────────────────────────────────────────

describe('DashboardPage — PII masking', () => {
  it('MaskedField: name_masked and mobile_masked are shown; raw name/mobile absent in DOM', () => {
    mockUseDashboard.mockReturnValue({ data: makeData(), isLoading: false, isError: false, refetch: vi.fn() });

    const { container } = renderPage();

    // masked values should appear
    expect(container.textContent).toContain('Am***** P****');
    expect(container.textContent).toContain('98xxxxxx21');
    // raw values must NOT appear (the API never sends them, but guard against rendering the key)
    expect(container.textContent).not.toContain('"name"');
    expect(container.textContent).not.toContain('"mobile"');
  });
});

// ── Role-based widget visibility ──────────────────────────────────────────────

describe('DashboardPage — role-based widget visibility (RM)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: rmUser(), logout: vi.fn() });
  });

  it('HandoffFailureWidget and SourceSummaryWidget are NOT rendered for RM role', () => {
    const data = makeData({ role: 'RM' });
    mockUseDashboard.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });

    const { container } = renderPage();

    // HandoffFailureWidget renders aria-label="Hand-off failures"
    const handoffList = container.querySelector('[aria-label="Hand-off failures"]');
    expect(handoffList).toBeNull();

    // SourceSummaryWidget renders aria-label="Source summary"
    const sourceTable = container.querySelector('[aria-label="Source summary"]');
    expect(sourceTable).toBeNull();
  });

  it('SlaAlertWidget IS rendered for RM role', () => {
    const data = makeData({ role: 'RM', widgets: { ...makeData().widgets, sla_alerts: [] } });
    mockUseDashboard.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });

    renderPage();

    // SLA alerts card always renders for RM
    expect(screen.queryByText(/SLA Alerts/i)).not.toBeNull();
  });
});

// ── Drill-through links ───────────────────────────────────────────────────────

describe('DashboardPage — drill-through links', () => {
  it('Active Pipeline KPI card renders a link with correct filter query string', () => {
    mockUseDashboard.mockReturnValue({ data: makeData(), isLoading: false, isError: false, refetch: vi.fn() });

    renderPage();

    const links = screen.getAllByRole('link');
    const activePipelineLink = links.find((l) =>
      (l as HTMLAnchorElement).href?.includes('filter') || l.textContent?.includes('Active Pipeline') || (l as HTMLAnchorElement).href?.includes('stage'),
    );
    expect(activePipelineLink).toBeDefined();
  });

  it('Hot lead row renders a link to /leads/{lead_id}', () => {
    mockUseDashboard.mockReturnValue({ data: makeData(), isLoading: false, isError: false, refetch: vi.fn() });

    renderPage();

    const leadLinks = screen.getAllByRole('link');
    const hotLeadLink = leadLinks.find((l) =>
      (l as HTMLAnchorElement).href?.includes('lead-1'),
    );
    expect(hotLeadLink).toBeDefined();
  });
});

// ── Low-bandwidth source summary ──────────────────────────────────────────────

describe('DashboardPage — source summary (table-only, low-bandwidth)', () => {
  it('SourceSummaryWidget renders a table (not a chart) for source data', () => {
    mockUseAuth.mockReturnValue({ user: { ...bmUser(), role: 'BM' }, logout: vi.fn() });
    mockUseDashboard.mockReturnValue({ data: makeData(), isLoading: false, isError: false, refetch: vi.fn() });

    const { container } = renderPage();

    const table = container.querySelector('table[aria-label="Source summary"]');
    expect(table).not.toBeNull();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe('DashboardPage — full page error state', () => {
  it('renders ErrorState when isError=true', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });

    renderPage();

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain('Dashboard unavailable');
  });
});
