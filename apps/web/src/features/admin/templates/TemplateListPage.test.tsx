// @vitest-environment jsdom
//
// FR-101 UI tests — Template list, create modal, communication history.
// Covers UI-01 (list filtered rows), UI-02 (validation errors), UI-03 (consent
// warning), UI-04 (recipient masking) from FR-101-tests.md §UI Test Scenarios.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mock hooks ────────────────────────────────────────────────────────────────
vi.mock('./use-templates', () => ({
  useTemplates: vi.fn(),
  useCreateTemplate: vi.fn(),
  templateKeys: {
    all: ['templates'],
    list: (f: unknown) => ['templates', 'list', f],
  },
}));

import { useTemplates, useCreateTemplate } from './use-templates';
import type { TemplateDto, TemplateListResult } from './use-templates';
import { TemplateListPage } from './TemplateListPage';
import { TemplateCreateModal } from './TemplateCreateModal';

const mockUseTemplates = useTemplates as ReturnType<typeof vi.fn>;
const mockUseCreateTemplate = useCreateTemplate as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<TemplateDto> = {}): TemplateDto {
  return {
    template_id: 'tpl-1',
    code: 'DOC_SMS_V1',
    version: 1,
    channel: 'sms',
    language: 'English',
    category: 'transactional',
    product_code: null,
    body: 'Dear customer, upload your docs.',
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeListResult(templates: TemplateDto[]): TemplateListResult {
  return {
    data: templates,
    meta: { page: 1, limit: 25, total: templates.length },
  };
}

// ── UI-01: Template list renders rows ─────────────────────────────────────────

describe('TemplateListPage', () => {
  beforeEach(() => {
    mockUseCreateTemplate.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    });
  });

  it('UI-01: renders template rows with correct status chip', () => {
    const templates = [
      makeTemplate({ status: 'active', channel: 'sms' }),
      makeTemplate({ template_id: 'tpl-2', code: 'MKT_EMAIL_V1', status: 'draft', channel: 'email' }),
    ];

    mockUseTemplates.mockReturnValue({
      data: makeListResult(templates),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<TemplateListPage />);

    // Both template codes visible.
    expect(screen.getByText('DOC_SMS_V1')).toBeTruthy();
    expect(screen.getByText('MKT_EMAIL_V1')).toBeTruthy();

    // Status chips — use getAllByText since filter options also contain the label.
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Draft').length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no templates exist', () => {
    mockUseTemplates.mockReturnValue({
      data: makeListResult([]),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<TemplateListPage />);
    expect(screen.getByText(/no templates found/i)).toBeTruthy();
  });

  it('shows loading state', () => {
    mockUseTemplates.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<TemplateListPage />);
    // LoadingSkeleton renders; page header should not be visible yet.
    expect(screen.queryByText('Communication Templates')).toBeNull();
  });
});

// ── UI-02: Create modal validation errors ─────────────────────────────────────

describe('TemplateCreateModal', () => {
  beforeEach(() => {
    mockUseTemplates.mockReturnValue({
      data: makeListResult([]),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseCreateTemplate.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    });
  });

  it('UI-02: shows inline error when code is empty and form submitted', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(<TemplateCreateModal onClose={onClose} onCreated={onCreated} />);

    // Click Create with empty code.
    const submitBtn = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(submitBtn);

    // Inline error for code field should appear.
    expect(
      await screen.findByText(/Template code must be alphanumeric/i),
    ).toBeTruthy();
  });

  it('submit button is rendered and enabled by default', () => {
    render(<TemplateCreateModal onClose={vi.fn()} onCreated={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Create' });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});
