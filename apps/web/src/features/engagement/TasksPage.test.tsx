// @vitest-environment jsdom
//
// FR-100 UI tests for the Tasks feature (TasksPage, TaskFiltersBar, OverdueQueuePanel,
// VisitLoggerSection). All API hooks are mocked so tests run without a network.
// Covers UI-01..UI-05 from FR-100-tests.md §UI Test Scenarios.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Mock all hooks before any component import ────────────────────────────────

vi.mock('./use-tasks', () => ({
  useTasks: vi.fn(),
  useCreateTask: vi.fn(),
  useUpdateTask: vi.fn(),
  taskKeys: { all: ['tasks'], list: (f: unknown) => ['tasks', 'list', f], detail: (id: string) => ['tasks', 'detail', id] },
}));

import { useTasks, useCreateTask, useUpdateTask } from './use-tasks';
import type { TaskDto, TaskListResult } from './use-tasks';
import { TasksPage } from './TasksPage';
import { TaskFiltersBar } from './TaskFilters';
import { VisitLoggerSection } from './VisitLoggerSection';

const mockUseTasks = useTasks as ReturnType<typeof vi.fn>;
const mockUseCreateTask = useCreateTask as ReturnType<typeof vi.fn>;
const mockUseUpdateTask = useUpdateTask as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    task_id: 'task-1',
    lead_id: 'lead-1',
    type: 'call',
    owner_id: 'user-1',
    due_at: new Date(Date.now() + 3_600_000).toISOString(),
    priority: 'normal',
    sla_policy_id: null,
    status: 'open',
    disposition: null,
    result_note: null,
    geo: null,
    next_action_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeListResult(tasks: TaskDto[]): TaskListResult {
  return {
    data: tasks,
    meta: { page: 1, limit: 25, total: tasks.length },
  };
}

function defaultMutations() {
  const mutateAsync = vi.fn().mockResolvedValue(makeTask());
  mockUseCreateTask.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, isError: false, error: null, reset: vi.fn() });
  mockUseUpdateTask.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, isError: false, error: null, reset: vi.fn() });
}

function renderTasksPage() {
  return render(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseTasks.mockReset();
  mockUseCreateTask.mockReset();
  mockUseUpdateTask.mockReset();
  defaultMutations();
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe('TasksPage — loading state', () => {
  it('renders LoadingSkeleton while isLoading=true', () => {
    mockUseTasks.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });

    renderTasksPage();

    const skeleton = screen.getByRole('status', { name: /loading/i });
    expect(skeleton).toBeDefined();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe('TasksPage — error state', () => {
  it('renders ErrorState when isError=true', () => {
    mockUseTasks.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('API down'), refetch: vi.fn() });

    renderTasksPage();

    // ErrorState renders role="alert"
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
  });
});

// ── Empty state (UI-04 scope isolation) ──────────────────────────────────────

describe('TasksPage — empty state', () => {
  it('renders EmptyState when task list is empty', () => {
    mockUseTasks.mockReturnValue({ data: makeListResult([]), isLoading: false, isError: false, error: null, refetch: vi.fn() });

    renderTasksPage();

    const empty = screen.getByRole('status');
    expect(empty.textContent).toContain('No tasks found');
  });
});

// ── Data table (UI-01 RM creates call task) ───────────────────────────────────

describe('TasksPage — task list table', () => {
  it('renders task rows in the DataTable', () => {
    const tasks = [makeTask({ task_id: 'task-1', type: 'call', status: 'open' })];
    mockUseTasks.mockReturnValue({ data: makeListResult(tasks), isLoading: false, isError: false, error: null, refetch: vi.fn() });

    const { container } = renderTasksPage();

    // DataTable renders a <table>; we check the cell content
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    // Status chip should show "Open"
    expect(container.textContent).toContain('Open');
    // Type cell: 'call'
    expect(container.textContent?.toLowerCase()).toContain('call');
  });

  it('shows StatusChip with "Overdue" styling for overdue tasks', () => {
    const tasks = [makeTask({ status: 'overdue' })];
    mockUseTasks.mockReturnValue({ data: makeListResult(tasks), isLoading: false, isError: false, error: null, refetch: vi.fn() });

    const { container } = renderTasksPage();

    expect(container.textContent).toContain('Overdue');
  });
});

// ── Create task button (UI-01) ────────────────────────────────────────────────

describe('TasksPage — create task modal', () => {
  it('opens the CreateTask modal when "Create Task" button is clicked', () => {
    mockUseTasks.mockReturnValue({ data: makeListResult([]), isLoading: false, isError: false, error: null, refetch: vi.fn() });

    renderTasksPage();

    // Page-level button text is "+ Create Task"
    const createBtn = screen.getByRole('button', { name: /\+ create task/i });
    fireEvent.click(createBtn);

    // Modal is a dialog element with a heading
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.textContent).toContain('Create Task');
  });

  it('UI-05: shows inline field error when due_at is empty on submit', async () => {
    mockUseTasks.mockReturnValue({ data: makeListResult([]), isLoading: false, isError: false, error: null, refetch: vi.fn() });

    renderTasksPage();

    // Open modal — click the page-level button (before dialog opens, only one button matches)
    fireEvent.click(screen.getByRole('button', { name: /\+ create task/i }));

    // Dialog is now open; find the submit button inside it
    const dialog = screen.getByRole('dialog');
    const submitBtn = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // Validation error should appear
      const errors = screen.getAllByRole('alert');
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

// ── Filters (TaskFiltersBar) ──────────────────────────────────────────────────

describe('TaskFiltersBar', () => {
  it('calls onChange when status filter is changed', () => {
    const onChange = vi.fn();
    render(<TaskFiltersBar filters={{}} onChange={onChange} />);

    const statusSelect = screen.getByLabelText(/status/i);
    fireEvent.change(statusSelect, { target: { value: 'overdue' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'overdue', page: 1 }));
  });

  it('calls onChange with undefined status when empty option selected', () => {
    const onChange = vi.fn();
    render(<TaskFiltersBar filters={{ status: 'open' }} onChange={onChange} />);

    const statusSelect = screen.getByLabelText(/status/i);
    fireEvent.change(statusSelect, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});

// ── VisitLoggerSection ────────────────────────────────────────────────────────

describe('VisitLoggerSection', () => {
  it('renders the capture location button when geo is null', () => {
    const onCapture = vi.fn();
    render(<VisitLoggerSection geo={null} onCapture={onCapture} />);

    expect(screen.getByRole('button', { name: /capture location/i })).toBeDefined();
  });

  it('shows captured coordinates when geo is provided', () => {
    const onCapture = vi.fn();
    const { container } = render(
      <VisitLoggerSection geo={{ lat: 12.9716, lng: 77.5946 }} onCapture={onCapture} />,
    );

    expect(container.textContent).toContain('12.97160');
    expect(container.textContent).toContain('77.59460');
  });

  it('renders graceful fallback message when geolocation is not available', async () => {
    // Simulate no geolocation API
    const origGeo = global.navigator.geolocation;
    Object.defineProperty(global.navigator, 'geolocation', { value: undefined, configurable: true });

    const onCapture = vi.fn();
    render(<VisitLoggerSection geo={null} onCapture={onCapture} />);

    fireEvent.click(screen.getByRole('button', { name: /capture location/i }));

    await waitFor(() => {
      expect(screen.getByText(/location access denied/i)).toBeDefined();
    });

    // Restore
    Object.defineProperty(global.navigator, 'geolocation', { value: origGeo, configurable: true });
  });
});
