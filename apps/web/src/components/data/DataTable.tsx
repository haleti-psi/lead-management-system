import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  defaultHidden?: boolean;
  className?: string;
}

export interface SortState {
  columnId: string;
  dir: 'asc' | 'desc';
}

export interface PaginationState {
  page: number;
  limit: number;
  total: number;
}

/** performance.md: default page size 25, max 100. */
export const PAGE_SIZES = [25, 50, 100] as const;

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  pagination: PaginationState;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** Enables the select-all/per-row checkboxes + bulk-action bar. */
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  /** Rendered in the toolbar while ≥1 row is selected (scope-aware bulk actions). */
  renderBulkActions?: (ids: string[]) => ReactNode;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
}

/**
 * Shared list/queue table (BRD §4.5 / ui.md §Data tables). Presentational and
 * server-driven: the host owns data, page, and sort (via React Query) and reacts
 * to the callbacks; the table owns column visibility and selection. Selection is
 * by row id and persists across pages (scope-aware bulk-select). Renders
 * loading / error / empty states. Sticky header; sort on allow-listed columns.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  pagination,
  onPageChange,
  onLimitChange,
  sort,
  onSortChange,
  selectable = false,
  onSelectionChange,
  renderBulkActions,
  isLoading = false,
  error = null,
  onRetry,
  emptyTitle,
  emptyMessage,
}: DataTableProps<T>): JSX.Element {
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  const visibleColumns = columns.filter((c) => !hidden.has(c.id));
  const pageIds = rows.map(getRowId);
  const allOnPageSelected = selectable && pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const emitSelection = (next: Set<string>): void => {
    setSelected(next);
    onSelectionChange?.([...next]);
  };
  const toggleRow = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emitSelection(next);
  };
  const toggleAllOnPage = (): void => {
    const next = new Set(selected);
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    emitSelection(next);
  };
  const toggleColumn = (id: string): void => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  };
  const onHeaderSort = (column: DataTableColumn<T>): void => {
    if (!column.sortable || !onSortChange) return;
    const dir = sort?.columnId === column.id && sort.dir === 'asc' ? 'desc' : 'asc';
    onSortChange({ columnId: column.id, dir });
  };

  const { page, limit, total } = pagination;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  const selectedIds = [...selected];

  return (
    <div className="space-y-3">
      {/* Toolbar: bulk actions (when selected) + column visibility */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {selectable && selectedIds.length > 0 ? (
            <>
              <span className="text-sm text-muted-foreground">{selectedIds.length} selected</span>
              {renderBulkActions?.(selectedIds)}
            </>
          ) : null}
        </div>
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setColumnMenuOpen((o) => !o)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Columns
          </Button>
          {columnMenuOpen ? (
            <div className="absolute right-0 z-10 mt-1 w-48 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-1 shadow-md">
              {columns.map((column) => (
                <label
                  key={column.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    checked={!hidden.has(column.id)}
                    onChange={() => toggleColumn(column.id)}
                  />
                  {column.header}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Body states */}
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : isLoading ? (
        <LoadingSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle ?? 'No results'} message={emptyMessage} />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <TableRow>
                {selectable ? (
                  <TableHead className="w-10">
                    <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Select all on page"
                        className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        checked={allOnPageSelected}
                        onChange={toggleAllOnPage}
                      />
                    </label>
                  </TableHead>
                ) : null}
                {visibleColumns.map((column) => {
                  const active = sort?.columnId === column.id;
                  const SortIcon = !column.sortable
                    ? null
                    : active && sort?.dir === 'asc'
                      ? ChevronUp
                      : active && sort?.dir === 'desc'
                        ? ChevronDown
                        : ChevronsUpDown;
                  return (
                    <TableHead
                      key={column.id}
                      className={cn(
                        'whitespace-nowrap text-xs font-semibold uppercase tracking-wide',
                        column.className,
                      )}
                    >
                      {column.sortable && onSortChange ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                          onClick={() => onHeaderSort(column)}
                          aria-label={`Sort by ${column.header}`}
                        >
                          {column.header}
                          {SortIcon ? <SortIcon className="h-3.5 w-3.5" aria-hidden /> : null}
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const id = getRowId(row);
                const isSelected = selected.has(id);
                return (
                  <TableRow key={id} data-state={isSelected ? 'selected' : undefined} className="[&>td]:py-3">
                    {selectable ? (
                      <TableCell className="w-10">
                        <label className="inline-flex items-center justify-center p-2 -m-2 cursor-pointer">
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            checked={isSelected}
                            onChange={() => toggleRow(id)}
                          />
                        </label>
                      </TableCell>
                    ) : null}
                    {visibleColumns.map((column) => (
                      <TableCell key={column.id} className={column.className}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination footer */}
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          {onLimitChange ? (
            <label className="flex items-center gap-1 text-sm text-muted-foreground">
              Rows
              <select
                aria-label="Rows per page"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={limit}
                onChange={(e) => onLimitChange(Number(e.target.value))}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className={cn('text-sm tabular-nums text-muted-foreground')}>
            Page {page} of {lastPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
