// @vitest-environment jsdom
//
// FR-122 — component tests for ExportButton, ExportRequestForm, ExportJobsPage, ExportApprovalQueue.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useExports', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useExports')>('@/hooks/useExports');
  return {
    ...actual,
    useCreateExport: vi.fn(),
    useListExports: vi.fn(),
    useGetExport: vi.fn(),
    useApproveExport: vi.fn(),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  useCreateExport,
  useListExports,
  useGetExport,
  useApproveExport,
  maskingOptionsForRole,
  isMaskingAllowed,
} from '@/hooks/useExports';
import type { MaskingLevel } from '@lms/shared';
import { ExportRequestForm } from './ExportRequestForm';
import { ExportButton } from './ExportButton';
import { ExportJobsPage } from './ExportJobsPage';
import { ExportApprovalQueue } from './ExportApprovalQueue';

const mockUseCreateExport = useCreateExport as ReturnType<typeof vi.fn>;
const mockUseListExports = useListExports as ReturnType<typeof vi.fn>;
const mockUseGetExport = useGetExport as ReturnType<typeof vi.fn>;
const mockUseApproveExport = useApproveExport as ReturnType<typeof vi.fn>;

function mutationStub(overrides?: Partial<{ mutate: ReturnType<typeof vi.fn>; isPending: boolean }>) {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  };
}

function listStub(rows: unknown[] = [], total = 0) {
  return {
    data: { data: rows, pagination: { page: 1, limit: 25, total } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function getExportStub(overrides: Partial<{ data: unknown; isLoading: boolean }> = {}) {
  return {
    data: undefined,
    isLoading: false,
    ...overrides,
  };
}

// ── maskingOptionsForRole ─────────────────────────────────────────────────

describe('maskingOptionsForRole', () => {
  it('RM gets only full (most restrictive minimum)', () => {
    expect(maskingOptionsForRole('RM')).toEqual(['full']);
  });

  it('BM gets full and partial (minimum = partial, rank <= 1)', () => {
    const opts = maskingOptionsForRole('BM');
    expect(opts).toContain('full');
    expect(opts).toContain('partial');
    expect(opts).not.toContain('unmasked');
  });

  it('DPO gets all three options (minimum = unmasked, all ranks ≤ 2)', () => {
    const opts = maskingOptionsForRole('DPO');
    expect(opts).toContain('full');
    expect(opts).toContain('partial');
    expect(opts).toContain('unmasked');
  });
});

// ── isMaskingAllowed ──────────────────────────────────────────────────────

describe('isMaskingAllowed', () => {
  it('RM: full is allowed, partial and unmasked are not', () => {
    expect(isMaskingAllowed('full', 'RM')).toBe(true);
    expect(isMaskingAllowed('partial', 'RM')).toBe(false);
    expect(isMaskingAllowed('unmasked', 'RM')).toBe(false);
  });

  it('DPO: all masking levels are allowed', () => {
    expect(isMaskingAllowed('full', 'DPO')).toBe(true);
    expect(isMaskingAllowed('partial', 'DPO')).toBe(true);
    expect(isMaskingAllowed('unmasked', 'DPO')).toBe(true);
  });

  it('BM: full and partial are allowed, unmasked is not', () => {
    expect(isMaskingAllowed('full', 'BM')).toBe(true);
    expect(isMaskingAllowed('partial', 'BM')).toBe(true);
    expect(isMaskingAllowed('unmasked', 'BM')).toBe(false);
  });
});

// ── ExportRequestForm ─────────────────────────────────────────────────────

describe('ExportRequestForm', () => {
  it('renders masking options filtered by role for RM (only full)', () => {
    const onSubmit = vi.fn();
    render(
      <ExportRequestForm
        reportCode="funnel_conversion"
        userRole="RM"
        onSubmit={onSubmit}
        isLoading={false}
      />,
    );

    const select = screen.getByLabelText(/masking level/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('full');
    expect(options).not.toContain('partial');
    expect(options).not.toContain('unmasked');
  });

  it('renders all masking options for DPO', () => {
    const onSubmit = vi.fn();
    render(
      <ExportRequestForm
        reportCode="consent_privacy_ops"
        userRole="DPO"
        onSubmit={onSubmit}
        isLoading={false}
      />,
    );

    const select = screen.getByLabelText(/masking level/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('full');
    expect(options).toContain('partial');
    expect(options).toContain('unmasked');
  });

  it('shows error when purpose is empty on submit', () => {
    const onSubmit = vi.fn();
    render(
      <ExportRequestForm
        reportCode="funnel_conversion"
        userRole="HEAD"
        onSubmit={onSubmit}
        isLoading={false}
      />,
    );

    const btn = screen.getByRole('button', { name: /request export/i });
    fireEvent.click(btn);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with correct payload when form is valid', () => {
    const onSubmit = vi.fn();
    render(
      <ExportRequestForm
        reportCode="funnel_conversion"
        userRole="HEAD"
        onSubmit={onSubmit}
        isLoading={false}
      />,
    );

    const purposeInput = screen.getByPlaceholderText(/e\.g\. monthly/i);
    fireEvent.change(purposeInput, { target: { value: 'monthly_review' } });

    const btn = screen.getByRole('button', { name: /request export/i });
    fireEvent.click(btn);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        report_code: 'funnel_conversion',
        masking_level: expect.any(String) as MaskingLevel,
        purpose: 'monthly_review',
      }),
    );
  });
});

// ── ExportButton ─────────────────────────────────────────────────────────

describe('ExportButton', () => {
  beforeEach(() => {
    mockUseCreateExport.mockReturnValue(mutationStub());
  });

  it('renders Export button', () => {
    render(<ExportButton reportCode="funnel_conversion" userRole="HEAD" />);
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy();
  });

  it('opens modal on button click', () => {
    render(<ExportButton reportCode="funnel_conversion" userRole="HEAD" />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    // Modal renders when open; find the heading inside it
    expect(screen.getAllByText(/request export/i).length).toBeGreaterThan(0);
  });
});

// ── ExportJobsPage ────────────────────────────────────────────────────────

describe('ExportJobsPage', () => {
  beforeEach(() => {
    // Always mock useGetExport to avoid destructuring errors
    mockUseGetExport.mockReturnValue(getExportStub());
  });

  it('shows loading skeleton while loading', () => {
    mockUseListExports.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    render(<ExportJobsPage />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeTruthy();
  });

  it('shows empty state when no exports', () => {
    mockUseListExports.mockReturnValue(listStub([], 0));
    render(<ExportJobsPage />);
    expect(screen.getByText(/no exports yet/i)).toBeTruthy();
  });

  it('renders export rows with status chip', () => {
    const rows = [
      {
        export_job_id: 'job-1',
        report_code: 'funnel_conversion',
        status: 'completed',
        masking_level: 'partial',
        scope: 'A',
        row_count: 42,
        approver_id: null,
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:01:00Z',
        download_url: null,
        download_url_expires_at: null,
      },
    ];
    mockUseListExports.mockReturnValue(listStub(rows, 1));
    render(<ExportJobsPage />);
    expect(screen.getByText('funnel_conversion')).toBeTruthy();
    // Status chip renders 'completed'
    expect(screen.getByText(/completed/i)).toBeTruthy();
  });
});

// ── ExportApprovalQueue ───────────────────────────────────────────────────

describe('ExportApprovalQueue', () => {
  beforeEach(() => {
    mockUseApproveExport.mockReturnValue(mutationStub());
  });

  it('shows empty state when no pending approvals', () => {
    mockUseListExports.mockReturnValue(listStub([], 0));
    render(<ExportApprovalQueue />);
    expect(screen.getByText(/no pending approvals/i)).toBeTruthy();
  });

  it('renders approval row with Approve button', () => {
    const rows = [
      {
        export_job_id: 'job-2',
        report_code: 'consent_privacy_ops',
        status: 'awaiting_approval',
        masking_level: 'unmasked',
        scope: 'A',
        row_count: null,
        approver_id: null,
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:00:00Z',
      },
    ];
    mockUseListExports.mockReturnValue(listStub(rows, 1));
    render(<ExportApprovalQueue />);
    expect(screen.getByText('consent_privacy_ops')).toBeTruthy();
    expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy();
  });

  it('opens confirm dialog on Approve click', () => {
    const rows = [
      {
        export_job_id: 'job-2',
        report_code: 'consent_privacy_ops',
        status: 'awaiting_approval',
        masking_level: 'unmasked',
        scope: 'A',
        row_count: null,
        approver_id: null,
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:00:00Z',
      },
    ];
    mockUseListExports.mockReturnValue(listStub(rows, 1));
    render(<ExportApprovalQueue />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/approve export\?/i)).toBeTruthy();
  });
});
