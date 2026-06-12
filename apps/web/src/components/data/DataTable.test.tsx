// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  name: string;
  score: number;
}

const rows: Row[] = [
  { id: '1', name: 'Alpha', score: 10 },
  { id: '2', name: 'Beta', score: 20 },
];

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
  { id: 'score', header: 'Score', cell: (r) => r.score },
];

function base(): {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (r: Row) => string;
} {
  return { columns, rows, getRowId: (r: Row) => r.id };
}

describe('DataTable', () => {
  it('renders rows and a result count', () => {
    render(<DataTable {...base()} pagination={{ page: 1, limit: 25, total: 2 }} onPageChange={vi.fn()} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText(/of 2/)).toBeTruthy();
  });

  it('shows the loading skeleton instead of rows', () => {
    render(
      <DataTable {...base()} isLoading pagination={{ page: 1, limit: 25, total: 0 }} onPageChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('shows an error state with a working retry', () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        {...base()}
        error="Upstream unavailable"
        onRetry={onRetry}
        pagination={{ page: 1, limit: 25, total: 0 }}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Upstream unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when there are no rows', () => {
    render(<DataTable {...base()} rows={[]} pagination={{ page: 1, limit: 25, total: 0 }} onPageChange={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('disables Previous on page 1 and advances on Next', () => {
    const onPageChange = vi.fn();
    render(<DataTable {...base()} pagination={{ page: 1, limit: 25, total: 60 }} onPageChange={onPageChange} />);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('emits a sort request from an allow-listed column header', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        {...base()}
        onSortChange={onSortChange}
        pagination={{ page: 1, limit: 25, total: 2 }}
        onPageChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'name', dir: 'asc' });
  });

  it('selects all rows on the page and surfaces the bulk-action count', () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        {...base()}
        selectable
        onSelectionChange={onSelectionChange}
        pagination={{ page: 1, limit: 25, total: 2 }}
        onPageChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select all on page'));
    expect(onSelectionChange).toHaveBeenCalledWith(['1', '2']);
    expect(screen.getByText('2 selected')).toBeTruthy();
  });
});
