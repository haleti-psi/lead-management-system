// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ProductConfig, ProductConfigListRow } from '@/types/product-config';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  retire: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/hooks/use-product-configs', () => ({
  useProductConfigs: () => mocks.list(),
  useProductConfig: () => mocks.detail(),
  useCreateProductConfig: () => ({ mutateAsync: mocks.create }),
  useUpdateProductConfig: () => ({ mutateAsync: mocks.update }),
  useRetireProductConfig: () => ({ mutateAsync: mocks.retire, isPending: false }),
}));
vi.mock('@/lib/auth/capabilities', () => ({ useCan: () => (c: string) => mocks.can(c) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProductConfigPage } from './ProductConfigPage';

function row(overrides: Partial<ProductConfigListRow> = {}): ProductConfigListRow {
  return {
    product_config_id: 'pc-1',
    product_code: 'CV',
    name: 'Commercial Vehicle v3',
    version: 3,
    status: 'active',
    pan_required_at: 'before_kyc',
    created_at: '2026-01-15T10:30:00Z',
    updated_at: '2026-01-20T14:00:00Z',
    created_by: 'u-1',
    ...overrides,
  };
}

function fullConfig(overrides: Partial<ProductConfig> = {}): ProductConfig {
  return {
    ...row(),
    org_id: 'org-1',
    updated_by: 'u-1',
    field_schema: {
      groups: [
        { id: 'asset', label: 'Asset', fields: [{ key: 'vehicle_type', label: 'Vehicle', type: 'text', mandatory: true }] },
      ],
    },
    document_checklist: { items: [{ doc_type: 'id', mandatory: true, applicant_scope: 'applicant' }] },
    sla_config: { capture_to_contact_hours: 4 },
    eligibility_mapping: { fields: [{ lms_field: 'vehicle_type', los_field: 'assetType' }] },
    ...overrides,
  };
}

function withRows(rows: ProductConfigListRow[]): void {
  mocks.list.mockReturnValue({
    data: { data: rows, pagination: { page: 1, limit: 25, total: rows.length } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

const NO_DETAIL = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

describe('ProductConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
    mocks.detail.mockReturnValue(NO_DETAIL);
  });

  it('renders config rows with version and a status chip', () => {
    withRows([
      row(),
      row({ product_config_id: 'pc-2', product_code: 'CAR', name: 'Car v1', version: 1, status: 'draft', pan_required_at: 'at_capture' }),
    ]);
    render(<ProductConfigPage />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Commercial Vehicle v3')).toBeTruthy();
    expect(within(table).getByText('v3')).toBeTruthy();
    expect(within(table).getByText('active')).toBeTruthy();
    expect(within(table).getByText('draft')).toBeTruthy();
    // PAN timing is humanised in the row, not the raw enum (scoped to the table so
    // the "Before KYC" filter <option> doesn't collide).
    expect(within(table).getByText('Before KYC')).toBeTruthy();
    expect(within(table).getByText('At capture')).toBeTruthy();
    expect(within(table).queryByText('before_kyc')).toBeNull();
  });

  it('shows Edit + Retire for active configs and View (no retire) for non-active', () => {
    withRows([row()]);
    const { unmount } = render(<ProductConfigPage />);
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /retire/i })).toBeTruthy();
    unmount();

    withRows([row({ status: 'retired' })]);
    render(<ProductConfigPage />);
    expect(screen.getByRole('button', { name: /view/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retire/i })).toBeNull();
  });

  it('blocks access without the configuration capability (no table, no actions)', () => {
    mocks.can.mockReturnValue(false);
    render(<ProductConfigPage />);
    expect(screen.getByText(/don't have access to product configuration/i)).toBeTruthy();
    // The list query is gated by `enabled: canManage`, so the table and the
    // "New configuration" affordance are not rendered.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /new configuration/i })).toBeNull();
  });

  it('shows the empty state when there are no configs', () => {
    withRows([]);
    render(<ProductConfigPage />);
    expect(screen.getByText('No product configurations found')).toBeTruthy();
  });

  it('shows the error state and offers retry on a failed load', () => {
    mocks.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<ProductConfigPage />);
    expect(screen.getByText('Could not load product configurations.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('opens the create modal with the maker-checker notice and required fields', () => {
    withRows([row()]);
    render(<ProductConfigPage />);
    fireEvent.click(screen.getByRole('button', { name: /new configuration/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/goes live only after a checker approves/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/product code/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/^name/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /submit for approval/i })).toBeTruthy();
  });

  it('validates required fields client-side before calling the API', () => {
    withRows([row()]);
    render(<ProductConfigPage />);
    fireEvent.click(screen.getByRole('button', { name: /new configuration/i }));
    const dialog = screen.getByRole('dialog');
    // Submit empty (product_code, name, pan all blank).
    fireEvent.click(within(dialog).getByRole('button', { name: /submit for approval/i }));
    expect(screen.getByText('Name is required.')).toBeTruthy();
    expect(screen.getByText('Select a product code.')).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('edit loads the full config and shows the new-draft-version notice', () => {
    withRows([row()]);
    mocks.detail.mockReturnValue({ data: fullConfig(), isLoading: false, isError: false, refetch: vi.fn() });
    render(<ProductConfigPage />);
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/creates a new draft version/i)).toBeTruthy();
    // Existing values are pre-filled.
    expect(within(dialog).getByDisplayValue('Commercial Vehicle v3')).toBeTruthy();
    // Product code is locked on edit.
    expect((within(dialog).getByLabelText(/product code/i) as HTMLSelectElement).disabled).toBe(true);
  });

  it('edit submits a PATCH (new draft version) with the merged payload', async () => {
    withRows([row()]);
    mocks.update.mockResolvedValue({ product_config_id: 'pc-9', version: 4, based_on_version: 3 });
    mocks.detail.mockReturnValue({ data: fullConfig(), isLoading: false, isError: false, refetch: vi.fn() });
    render(<ProductConfigPage />);
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: 'Commercial Vehicle v4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /submit for approval/i }));

    // Let the async submit handler resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const arg = mocks.update.mock.calls[0][0] as { productConfigId: string; body: { name: string } };
    expect(arg.productConfigId).toBe('pc-1');
    expect(arg.body.name).toBe('Commercial Vehicle v4');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
